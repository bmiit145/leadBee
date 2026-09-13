import type { IAccount } from '../../models/Account.js';
import { User } from '../../models/User.js';
import { AppError } from '../../lib/errors.js';
import { withoutTenantScope } from '../../lib/tenantContext.js';
import { env } from '../../config/env.js';
import { organizationService } from '../organizations/organization.service.js';
import { authService, type LoginResult } from '../auth/auth.service.js';
import { accountSessionService } from './accountSession.service.js';

export interface CreateOrganizationDetails {
  organizationName: string;
  slug?: string;
}

/**
 * A signed-in person with no organization creates their own.
 *
 * The organization is provisioned exactly as self-serve signup provisions one
 * (`organizationService.provision`), so the tenant is the same shape whichever
 * door it came through. The difference is who the owner is: here it is the
 * account already signed in, so no name, email, mobile or password is asked for
 * again — `provision` links the existing account instead of creating one.
 *
 * On success the person is signed straight into the new organization, and
 * their account sessions end everywhere: they belong to an organization now,
 * so an account session has nothing left to do.
 */
export const accountOrganizationService = {
  async create(account: IAccount, details: CreateOrganizationDetails): Promise<LoginResult> {
    if (!env.ALLOW_SELF_SERVE_SIGNUP) {
      throw AppError.forbidden(
        'Creating an organization yourself is disabled. Contact sales to have one provisioned.'
      );
    }

    // Also what stops a double tap from creating two organizations: the second
    // request finds the first one's membership. Two truly simultaneous requests
    // for the same name collide on the handle's unique index instead.
    if ((await accountSessionService.organizationCount(account._id)) > 0) {
      throw AppError.conflict('You already belong to an organization. Sign in again to open it.');
    }

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

    await accountSessionService.endAll(account._id);
    return authService.openMembershipSession(membership, organization);
  },
};
