import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { User, type IUser } from '../../models/User.js';
import { Account, ACCOUNT_STATUSES } from '../../models/Account.js';
import { Role } from '../../models/Role.js';
import { Organization, type IOrganization } from '../../models/Organization.js';
import { AppError } from '../../lib/errors.js';
import { normalizePhone } from '../../lib/phone.js';
import { signTokenPair, verifyRefreshToken, type TokenPair } from '../../lib/tokens.js';
import { runInTenantScope, withoutTenantScope } from '../../lib/tenantContext.js';
import { identifierKind } from '../accounts/identity.js';
import { identityService } from '../accounts/identity.service.js';

/** How many concurrent sessions one membership may hold. Oldest is evicted past this. */
const MAX_SESSIONS = 5;

/**
 * Refresh tokens are stored as SHA-256 hashes, never in the clear.
 *
 * A dump of the users collection then yields nothing usable: the attacker has
 * the hash, but presenting it is not presenting a valid JWT. Plain storage would
 * make that dump a set of live 30-day sessions.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Compared against when no account matched, so an unknown email costs the same
 * bcrypt round as a wrong password. Without it, response time alone would say
 * which identifiers exist. Computed once, on first use.
 */
let timingHash: Promise<string> | undefined;
const timingEqualizer = () => (timingHash ??= bcrypt.hash('leadbee:sign-in-timing', 12));

export interface LoginResult {
  user: IUser;
  organization: IOrganization;
  tokens: TokenPair;
}

/** One of the organizations an account belongs to, offered for selection. */
export interface OrgChoice {
  _id: string;
  name: string;
  slug: string;
}

export const authService = {
  /**
   * Email or mobile number, plus the one password the person has.
   *
   * The account is checked first — it is who the person is — and then the
   * organization: the only one they belong to, or the one they pick. This is one
   * of the few deliberately cross-tenant reads in the system, because a
   * person's memberships live in different tenants. See ADR-0004.
   */
  async login(
    identifier: string,
    password: string,
    organizationId?: string
  ): Promise<LoginResult | { needsOrgSelection: true; organizations: OrgChoice[] }> {
    // One generic failure for "no such account" and "wrong password" alike, so
    // this endpoint does not become an oracle for which identifiers exist.
    const invalid = () => AppError.unauthorized('Invalid email, mobile number or password');

    const lookup =
      identifierKind(identifier) === 'email'
        ? { email: identifier.trim().toLowerCase() }
        : { phone: normalizePhone(identifier) };

    const account = await Account.findOne(lookup).select('+password');
    if (!account) {
      await bcrypt.compare(password, await timingEqualizer());
      throw invalid();
    }
    if (!(await bcrypt.compare(password, account.password))) throw invalid();

    // After the password, so a suspension is only ever revealed to the owner.
    if (account.status !== ACCOUNT_STATUSES.ACTIVE) throw AppError.accountSuspended();

    const memberships = await withoutTenantScope(
      'login: the organizations this account belongs to',
      // `refreshTokens` is `select: false` and needed: a successful login stores
      // one, and without it the array is undefined and the push throws *after*
      // the password has already been verified.
      () => User.find({ accountId: account._id }).select('+refreshTokens').exec()
    );

    if (memberships.length === 0) {
      throw new AppError(
        'Your account is not part of an organization yet.',
        403,
        'NO_ORGANIZATION'
      );
    }

    const active = memberships.filter((membership) => membership.isActive);
    if (active.length === 0) {
      throw AppError.forbidden('This account has been deactivated in every organization it belongs to.');
    }

    let user: IUser;
    if (organizationId) {
      const chosen = active.find((membership) => membership.organizationId.equals(organizationId));
      if (!chosen) throw AppError.forbidden('You are not an active member of that organization.');
      user = chosen;
    } else if (active.length > 1) {
      const orgs = await withoutTenantScope('login: org selection list', () =>
        Organization.find({ _id: { $in: active.map((membership) => membership.organizationId) } })
          .select('name slug')
          .lean()
      );
      return {
        needsOrgSelection: true,
        organizations: orgs.map((o) => ({
          _id: o._id.toString(),
          name: o.name,
          slug: o.slug,
        })),
      };
    } else {
      user = active[0]!;
    }

    const organization = await withoutTenantScope('login: load tenant', () =>
      Organization.findById(user.organizationId).exec()
    );
    if (!organization) throw invalid();

    if (!organization.isUsable()) {
      throw AppError.orgInactive(
        organization.status === 'suspended'
          ? 'This organization has been suspended. Contact support.'
          : 'This organization is not active. Contact your administrator.',
        { status: organization.status }
      );
    }

    const scope = {
      organizationId: user.organizationId,
      userId: user._id,
      role: user.role,
      permissions: [],
    };

    const tokens = await runInTenantScope(scope, async () => {
      const permissions = await effectivePermissions(user);
      const pair = signTokenPair('tenant', {
        sub: user._id.toString(),
        org: user.organizationId.toString(),
        role: user.role,
        permissions,
      });
      await storeRefreshToken(user, pair.refreshToken);
      return pair;
    });

    user.permissions = await runInTenantScope(scope, () => effectivePermissions(user));

    // Fire-and-forget: last-seen for the console, kept off the login latency path.
    void Account.updateOne({ _id: account._id }, { $set: { lastLoginAt: new Date() } }).catch(
      () => undefined
    );
    void Organization.updateOne(
      { _id: organization._id },
      { $set: { 'usage.lastActivityAt': new Date() } }
    ).catch(() => undefined);

    return { user, organization, tokens };
  },

  /**
   * Rotate a refresh token: the presented one is consumed and a fresh pair is
   * issued. Presenting a token that is not on the membership's list means it was
   * already rotated — i.e. someone is replaying a stolen token — so every
   * session is revoked rather than just this one.
   */
  async refresh(refreshToken: string): Promise<LoginResult> {
    const payload = verifyRefreshToken('tenant', refreshToken);
    if (!Types.ObjectId.isValid(payload.sub)) {
      throw AppError.unauthorized('Invalid refresh token');
    }

    const user = await withoutTenantScope('refresh: resolve user before scope', () =>
      User.findById(payload.sub).select('+refreshTokens').exec()
    );
    if (!user || !user.isActive) {
      throw AppError.unauthorized('User not found or inactive');
    }

    // A suspended person gets no new tokens, in any organization.
    const account = await Account.findById(user.accountId)
      .select('status')
      .lean<{ status: string }>();
    if (!account) throw AppError.unauthorized('Account not found');
    if (account.status !== ACCOUNT_STATUSES.ACTIVE) throw AppError.accountSuspended();

    const organization = await withoutTenantScope('refresh: load tenant', () =>
      Organization.findById(user.organizationId).exec()
    );
    if (!organization || !organization.isUsable()) {
      throw AppError.orgInactive('This organization is not active.');
    }

    const presented = hashToken(refreshToken);
    const index = user.refreshTokens.indexOf(presented);
    if (index === -1) {
      user.refreshTokens = [];
      await user.save();
      throw AppError.unauthorized('Refresh token reuse detected. All sessions revoked.');
    }
    user.refreshTokens.splice(index, 1);

    return runInTenantScope(
      {
        organizationId: user.organizationId,
        userId: user._id,
        role: user.role,
        permissions: [],
      },
      async () => {
        const permissions = await effectivePermissions(user);
        const tokens = signTokenPair('tenant', {
          sub: user._id.toString(),
          org: user.organizationId.toString(),
          role: user.role,
          permissions,
        });
        await storeRefreshToken(user, tokens.refreshToken);
        user.permissions = permissions;
        return { user, organization, tokens };
      }
    );
  },

  /**
   * Drop one session. Never errors on an unknown token — logout is idempotent.
   *
   * The push token goes too. It belongs to a device, not a person: left in
   * place, the next user to sign in on a shared handset would receive the
   * previous user's lead and task alerts until they registered their own. A
   * user on a second device loses push there until that app next starts and
   * re-registers, which is the cheaper mistake.
   */
  async logout(userId: Types.ObjectId, refreshToken?: string): Promise<void> {
    await User.updateOne(
      { _id: userId },
      refreshToken
        ? { $pull: { refreshTokens: hashToken(refreshToken) }, $unset: { pushToken: 1 } }
        : { $unset: { pushToken: 1 } }
    );
  },

  /**
   * "Sign out everywhere" — every session this person holds, in every
   * organization, because it is one person and one password.
   */
  async logoutAll(userId: Types.ObjectId): Promise<void> {
    const user = await User.findById(userId).select('accountId');
    if (!user) return;
    await identityService.revokeSessions(user.accountId);
    await User.updateOne({ _id: userId }, { $unset: { pushToken: 1 } });
  },

  /**
   * Changes the person's one password. Every session in every organization
   * ends, or the attacker whose access prompted the change keeps theirs.
   */
  async changePassword(
    userId: Types.ObjectId,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const user = await User.findById(userId).select('accountId');
    if (!user) throw AppError.notFound('User not found');

    if (!(await identityService.verifyPassword(user.accountId, currentPassword))) {
      throw AppError.unauthorized('Current password is incorrect');
    }
    await identityService.setPassword(user.accountId, newPassword);
  },

  /**
   * A push token names a device, not a person, so it belongs to one membership.
   *
   * Registering takes it from whoever held it before — in any tenant, because
   * one handset can be signed into different organizations over time. Clearing
   * it on logout is not enough: a session that ends without reaching the server
   * (revoked by an admin, expired while offline) left the old membership holding
   * the token, and its lead alerts, contact names included, kept arriving on
   * the next user's phone. Keyed on the token alone, which the caller has just
   * shown it holds.
   */
  async updatePushToken(userId: Types.ObjectId, pushToken: string): Promise<void> {
    await withoutTenantScope('push token moves to the account now signed in on its device', () =>
      User.updateMany({ pushToken, _id: { $ne: userId } }, { $unset: { pushToken: 1 } }).exec()
    );
    await User.updateOne({ _id: userId }, { $set: { pushToken } });
  },
};

/** Role permissions ∪ per-user grants. */
export async function effectivePermissions(user: IUser): Promise<string[]> {
  if (!user.roleId) return [...new Set(user.permissions ?? [])];
  const role = await Role.findById(user.roleId).select('permissions').lean();
  return [...new Set([...(role?.permissions ?? []), ...(user.permissions ?? [])])];
}

async function storeRefreshToken(user: IUser, refreshToken: string): Promise<void> {
  user.refreshTokens.push(hashToken(refreshToken));
  if (user.refreshTokens.length > MAX_SESSIONS) {
    user.refreshTokens = user.refreshTokens.slice(-MAX_SESSIONS);
  }
  user.lastLoginAt = new Date();
  await user.save();
}
