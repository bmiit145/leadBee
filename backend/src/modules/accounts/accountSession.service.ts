import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { Account, ACCOUNT_STATUSES, type IAccount } from '../../models/Account.js';
import { User } from '../../models/User.js';
import { AppError } from '../../lib/errors.js';
import { signTokenPair, verifyRefreshToken, type TokenPair } from '../../lib/tokens.js';
import { withoutTenantScope } from '../../lib/tenantContext.js';

/**
 * The session a person holds while they belong to no organization.
 *
 * Registering creates a person, not a tenant (ADR-0003), so the first sign-in
 * after it has no organization to open. Refusing that sign-in would strand the
 * person at a login screen that rejects a correct password; this issues a
 * session in its own realm instead (`leadbee:account`, ADR-0004). It reaches the
 * person's own account and nothing else — no tenant scope, no permissions — and
 * is where "create an organization" and "join one" will be started from.
 *
 * Membership sessions are unchanged: once a person belongs to an organization,
 * sign-in issues a tenant session, as before.
 */

/** Same ceiling as a membership: the oldest session is evicted past this. */
const MAX_SESSIONS = 5;

/** Stored as SHA-256 hashes, never in the clear — see auth.service.ts. */
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface AccountSession {
  account: IAccount;
  tokens: TokenPair;
}

export const accountSessionService = {
  /** Called by sign-in, after the password and account status are verified. */
  async start(account: IAccount): Promise<AccountSession> {
    const tokens = signTokenPair('account', { sub: account._id.toString() });
    await Account.updateOne(
      { _id: account._id },
      {
        $push: { refreshTokens: { $each: [hashToken(tokens.refreshToken)], $slice: -MAX_SESSIONS } },
        $set: { lastLoginAt: new Date() },
      }
    );
    return { account, tokens };
  },

  /**
   * Rotates a refresh token. A token that is not on the account's list was
   * already rotated — someone is replaying it — so every account session ends.
   */
  async refresh(refreshToken: string): Promise<AccountSession> {
    const payload = verifyRefreshToken('account', refreshToken);
    if (!Types.ObjectId.isValid(payload.sub)) {
      throw AppError.unauthorized('Invalid refresh token');
    }

    const account = await Account.findById(payload.sub);
    if (!account) throw AppError.unauthorized('Account not found');
    if (account.status !== ACCOUNT_STATUSES.ACTIVE) throw AppError.accountSuspended();

    // Consumed atomically: of two requests presenting one token, one wins.
    const presented = hashToken(refreshToken);
    const consumed = await Account.updateOne(
      { _id: account._id, refreshTokens: presented },
      { $pull: { refreshTokens: presented } }
    );
    if (consumed.modifiedCount === 0) {
      await Account.updateOne({ _id: account._id }, { $set: { refreshTokens: [] } });
      throw AppError.unauthorized('Refresh token reuse detected. All sessions revoked.');
    }

    const tokens = signTokenPair('account', { sub: account._id.toString() });
    await Account.updateOne(
      { _id: account._id },
      { $push: { refreshTokens: { $each: [hashToken(tokens.refreshToken)], $slice: -MAX_SESSIONS } } }
    );
    return { account, tokens };
  },

  /**
   * Ends every account session the person holds, on every device. Used once
   * they belong to an organization, when an account session has no further
   * purpose: a device still holding one fails its next refresh and signs in to
   * the organization instead.
   */
  async endAll(accountId: Types.ObjectId): Promise<void> {
    await Account.updateOne({ _id: accountId }, { $set: { refreshTokens: [] } });
  },

  /** Idempotent: an unknown or absent token is not an error. */
  async logout(accountId: Types.ObjectId, refreshToken?: string): Promise<void> {
    if (!refreshToken) return;
    await Account.updateOne({ _id: accountId }, { $pull: { refreshTokens: hashToken(refreshToken) } });
  },

  /**
   * How many organizations the person now belongs to. Non-zero means someone
   * added them since this session began, and the client should sign in again
   * to open the organization.
   */
  async organizationCount(accountId: Types.ObjectId): Promise<number> {
    return withoutTenantScope('account session: whether this person has joined an organization', () =>
      User.countDocuments({ accountId, isActive: true }).exec()
    );
  },
};
