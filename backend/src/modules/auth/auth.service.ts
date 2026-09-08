import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { User, type IUser } from '../../models/User.js';
import { Role } from '../../models/Role.js';
import { Organization, type IOrganization } from '../../models/Organization.js';
import { AppError } from '../../lib/errors.js';
import { signTokenPair, verifyRefreshToken, type TokenPair } from '../../lib/tokens.js';
import { runInTenantScope, withoutTenantScope } from '../../lib/tenantContext.js';

/** How many concurrent sessions one user may hold. Oldest is evicted past this. */
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

export interface LoginResult {
  user: IUser;
  organization: IOrganization;
  tokens: TokenPair;
}

/** One of the organizations a phone number belongs to, offered for selection. */
export interface OrgChoice {
  _id: string;
  name: string;
  slug: string;
}

export const authService = {
  /**
   * Phone + password, with the organization inferred where possible.
   *
   * Phone is unique *per tenant*, not globally — the same person can work for
   * two customers. So this is one of the few deliberately cross-tenant reads in
   * the system. Where the phone resolves to exactly one org (the overwhelming
   * majority) the login screen never has to mention organizations at all.
   */
  async login(
    phone: string,
    password: string,
    organizationId?: string
  ): Promise<LoginResult | { needsOrgSelection: true; organizations: OrgChoice[] }> {
    const candidates = await withoutTenantScope('login: phone is unique per tenant', () => {
      const filter: Record<string, unknown> = { phone: phone.trim(), isActive: true };
      if (organizationId) filter.organizationId = new Types.ObjectId(organizationId);
      // Both fields are `select: false`. `refreshTokens` is needed because a
      // successful login stores one — without it the array is undefined and the
      // push throws *after* the password has already been verified.
      return User.find(filter).select('+password +refreshTokens').exec();
    });

    // One generic failure for "no such phone" and "wrong password" alike. Two
    // distinct messages would turn this endpoint into a phone-number oracle.
    const invalid = () => AppError.unauthorized('Invalid phone number or password');
    if (candidates.length === 0) throw invalid();

    const matched: IUser[] = [];
    for (const candidate of candidates) {
      if (await candidate.comparePassword(password)) matched.push(candidate);
    }
    if (matched.length === 0) throw invalid();

    if (matched.length > 1) {
      const orgs = await withoutTenantScope('login: org selection list', () =>
        Organization.find({ _id: { $in: matched.map((u) => u.organizationId) } })
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
    }

    const user = matched[0]!;
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

    const tokens = await runInTenantScope(
      {
        organizationId: user.organizationId,
        userId: user._id,
        role: user.role,
        permissions: [],
      },
      async () => {
        const permissions = await effectivePermissions(user);
        const pair = signTokenPair('tenant', {
          sub: user._id.toString(),
          org: user.organizationId.toString(),
          role: user.role,
          permissions,
        });
        await storeRefreshToken(user, pair.refreshToken);
        return pair;
      }
    );

    user.permissions = await runInTenantScope(
      {
        organizationId: user.organizationId,
        userId: user._id,
        role: user.role,
        permissions: [],
      },
      () => effectivePermissions(user)
    );

    // Cheap enough to be worth it: the console shows last-seen per user, and a
    // fire-and-forget write keeps it off the login latency path.
    void Organization.updateOne(
      { _id: organization._id },
      { $set: { 'usage.lastActivityAt': new Date() } }
    ).catch(() => undefined);

    return { user, organization, tokens };
  },

  /**
   * Rotate a refresh token: the presented one is consumed and a fresh pair is
   * issued. Presenting a token that is not on the user's list means it was
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

  /** Drop one session. Never errors on an unknown token — logout is idempotent. */
  async logout(userId: Types.ObjectId, refreshToken?: string): Promise<void> {
    if (!refreshToken) return;
    await User.updateOne(
      { _id: userId },
      { $pull: { refreshTokens: hashToken(refreshToken) } }
    );
  },

  /** Drop every session — "sign out everywhere", and what a password change does. */
  async logoutAll(userId: Types.ObjectId): Promise<void> {
    await User.updateOne({ _id: userId }, { $set: { refreshTokens: [] } });
  },

  async changePassword(
    userId: Types.ObjectId,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const user = await User.findById(userId).select('+password +refreshTokens');
    if (!user) throw AppError.notFound('User not found');

    if (!(await user.comparePassword(currentPassword))) {
      throw AppError.unauthorized('Current password is incorrect');
    }

    user.password = newPassword;
    // Changing a password must end every other session, or the attacker whose
    // access prompted the change keeps theirs.
    user.refreshTokens = [];
    await user.save();
  },

  async updatePushToken(userId: Types.ObjectId, pushToken: string): Promise<void> {
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
