import type { Types } from 'mongoose';
import type { IAccount } from '../../models/Account.js';
import { User } from '../../models/User.js';
import { AppError } from '../../lib/errors.js';
import { withoutTenantScope } from '../../lib/tenantContext.js';
import { env } from '../../config/env.js';
import { ROLES } from '../../config/constants.js';
import { organizationService } from '../organizations/organization.service.js';
import { authService, type LoginResult } from '../auth/auth.service.js';
import { accountSessionService } from './accountSession.service.js';

export interface CreateOrganizationDetails {
  organizationName: string;
  slug?: string;
}

/**
 * Where the request came from, because what happens to the caller's session
 * afterwards differs:
 *
 * - `account` — a person with no organization yet. Their account sessions end
 *   everywhere; they have no further purpose.
 * - `membership` — someone already inside an organization, creating another.
 *   Only this device's session in the organization they are leaving ends; their
 *   other devices stay where they are.
 */
export type CreateOrganizationOrigin =
  | { via: 'account' }
  | { via: 'membership'; userId: Types.ObjectId; refreshToken?: string };

export interface Ownership {
  owned: number;
  limit: number;
  /** Whether the person may create one more right now. */
  canCreate: boolean;
}

/**
 * Organizations this person owns, against the most they may own.
 *
 * Ownership is the `owner` role on a membership. Organizations someone was
 * invited into do not count. The limit is the account's own when platform
 * staff set one, else the platform default — until plans grant it (KNOWN-GAPS
 * 6.9). Checked on the server only (CFG-8); the client just displays it.
 */
export async function ownershipOf(
  account: Pick<IAccount, '_id' | 'ownedOrganizationLimit'>
): Promise<Ownership> {
  const owned = await withoutTenantScope('ownership: organizations this person owns', () =>
    User.countDocuments({ accountId: account._id, role: ROLES.OWNER }).exec()
  );
  const limit = account.ownedOrganizationLimit ?? env.DEFAULT_OWNED_ORGANIZATION_LIMIT;
  return { owned, limit, canCreate: env.ALLOW_SELF_SERVE_SIGNUP && owned < limit };
}

/**
 * A signed-in person creates an organization they will own.
 *
 * Provisioned exactly as self-serve signup provisions one
 * (`organizationService.provision`), so the tenant is the same shape whichever
 * door it came through. The owner is the account already signed in, so no name,
 * email, mobile or password is asked for again — `provision` links the account
 * instead of creating one. On success the person is signed straight into the
 * new organization.
 */
export const accountOrganizationService = {
  async create(
    account: IAccount,
    details: CreateOrganizationDetails,
    origin: CreateOrganizationOrigin
  ): Promise<LoginResult> {
    if (!env.ALLOW_SELF_SERVE_SIGNUP) {
      throw AppError.forbidden(
        'Creating an organization yourself is disabled. Contact sales to have one provisioned.'
      );
    }

    // An account session exists only for someone with no organization. Past
    // that, creating goes through the membership route — which is also what
    // stops a double tap on the first create from making two organizations.
    if (
      origin.via === 'account' &&
      (await accountSessionService.organizationCount(account._id)) > 0
    ) {
      throw AppError.conflict('You already belong to an organization. Sign in again to open it.');
    }

    const ownership = await ownershipOf(account);
    if (ownership.owned >= ownership.limit) {
      throw new AppError(
        `You can own up to ${ownership.limit} organizations, and you already own ${ownership.owned}.`,
        403,
        'ORGANIZATION_LIMIT_REACHED',
        { owned: ownership.owned, limit: ownership.limit }
      );
    }

    // Two simultaneous requests for the same name collide on the handle's
    // unique index, so a double tap cannot create a duplicate.
    const { organization, owner } = await organizationService.provision({
      organizationName: details.organizationName,
      slug: details.slug,
      ownerName: `${account.firstName} ${account.lastName ?? ''}`.trim(),
      ownerPhone: account.phone,
      ownerEmail: account.email,
      source: 'self_serve',
    });

    // Re-read with the stored session hashes, which the sign-in below appends to.
    const membership = await withoutTenantScope(
      'create organization: the new owner membership, to sign it in',
      () => User.findById(owner._id).select('+refreshTokens').exec()
    );
    if (!membership) throw AppError.internal('The new organization has no owner membership.');

    if (origin.via === 'account') {
      await accountSessionService.endAll(account._id);
    } else {
      await authService.logout(origin.userId, origin.refreshToken);
    }
    return authService.openMembershipSession(membership, organization);
  },
};
