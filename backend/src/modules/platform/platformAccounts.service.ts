import { Types, type FilterQuery } from 'mongoose';
import {
  Account,
  ACCOUNT_STATUSES,
  type AccountStatus,
  type EmailVerifiedVia,
  type IAccount,
} from '../../models/Account.js';
import { PlatformAdmin, type IPlatformAdmin } from '../../models/PlatformAdmin.js';
import { PlatformAuditLog } from '../../models/PlatformAuditLog.js';
import { AppError } from '../../lib/errors.js';
import { pageParams } from '../../lib/pagination.js';
import { ACCOUNT_VERIFICATION_MAX_ATTEMPTS } from '../accounts/account.service.js';
import { recordPlatformAction } from './platform.service.js';

/**
 * The control plane's view of registered people.
 *
 * Every write is an explicit, reasoned, audited action (DASH-2, DASH-13). No
 * response ever carries a password hash or a verification hash: rows are mapped
 * field by field rather than spread, so a field added to the model later does
 * not leak here by default.
 */

export type VerificationFilter = 'verified' | 'unverified';

export interface AccountListFilters {
  search?: string;
  status?: AccountStatus;
  verification?: VerificationFilter;
  sort?: 'newest' | 'oldest' | 'name';
  page?: number;
  limit?: number;
}

export interface AuditContext {
  ip?: string;
  userAgent?: string;
}

const AUDIT_TARGET = 'Account';
const ACTIVITY_LIMIT = 50;
/** Words beyond this are ignored; a search box is not a query language. */
const SEARCH_TERMS_MAX = 5;

const SORTS: Record<NonNullable<AccountListFilters['sort']>, Record<string, 1 | -1>> = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  name: { firstName: 1, lastName: 1, _id: 1 },
};

const SUMMARY_FIELDS =
  'firstName lastName email phone status emailVerifiedAt emailVerifiedVia ' +
  'suspendedAt suspendedReason createdAt updatedAt';

interface AccountRow {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: AccountStatus;
  emailVerifiedAt?: Date;
  emailVerifiedVia?: EmailVerifiedVia;
  suspendedAt?: Date;
  suspendedReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface AccountDetailRow extends AccountRow {
  acceptedTermsAt?: Date;
  signupIp?: string;
  signupUserAgent?: string;
  internalNotes?: string;
  suspendedBy?: Types.ObjectId;
  verification?: { expiresAt: Date; attempts: number; sentAt: Date };
}

export const platformAccountsService = {
  async listAccounts(filters: AccountListFilters) {
    const query: FilterQuery<IAccount> = {};
    if (filters.status) query.status = filters.status;
    if (filters.verification === 'verified') query.emailVerifiedAt = { $exists: true };
    if (filters.verification === 'unverified') query.emailVerifiedAt = { $exists: false };

    // Each word must match some field, so "asha mehta" finds Asha Mehta even
    // though no single field holds both words.
    const terms = (filters.search ?? '').split(/\s+/).filter(Boolean).slice(0, SEARCH_TERMS_MAX);
    if (terms.length > 0) {
      query.$and = terms.map((term) => {
        const pattern = new RegExp(escapeRegex(term), 'i');
        return {
          $or: [
            { firstName: pattern },
            { lastName: pattern },
            { email: pattern },
            { phone: pattern },
          ],
        };
      });
    }

    const { page, limit, skip } = pageParams(filters);
    const [rows, total] = await Promise.all([
      Account.find(query)
        .select(SUMMARY_FIELDS)
        .sort(SORTS[filters.sort ?? 'newest'])
        .skip(skip)
        .limit(limit)
        .lean<AccountRow[]>(),
      Account.countDocuments(query),
    ]);

    return { data: rows.map(toSummary), total, page, limit };
  },

  async stats() {
    const now = Date.now();
    const days = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000);

    const [total, verified, suspended, last7Days, last30Days] = await Promise.all([
      Account.countDocuments(),
      Account.countDocuments({ emailVerifiedAt: { $exists: true } }),
      Account.countDocuments({ status: ACCOUNT_STATUSES.SUSPENDED }),
      Account.countDocuments({ createdAt: { $gte: days(7) } }),
      Account.countDocuments({ createdAt: { $gte: days(30) } }),
    ]);

    return {
      total,
      verified,
      unverified: total - verified,
      suspended,
      last7Days,
      last30Days,
      generatedAt: new Date(now).toISOString(),
    };
  },

  async getAccount(accountId: string) {
    const account = await Account.findById(accountId)
      .select('+verification')
      .lean<AccountDetailRow>();
    if (!account) throw AppError.notFound('Account not found');

    const [suspendedBy, activity] = await Promise.all([
      account.suspendedBy
        ? PlatformAdmin.findById(account.suspendedBy)
            .select('name email')
            .lean<{ _id: Types.ObjectId; name: string; email: string }>()
        : null,
      PlatformAuditLog.find({ targetType: AUDIT_TARGET, targetId: account._id })
        .select('action adminEmail adminRole reason before after createdAt')
        .sort({ createdAt: -1 })
        .limit(ACTIVITY_LIMIT)
        .lean<
          Array<{
            _id: Types.ObjectId;
            action: string;
            adminEmail: string;
            adminRole: string;
            reason?: string;
            before?: Record<string, unknown>;
            after?: Record<string, unknown>;
            createdAt: Date;
          }>
        >(),
    ]);

    const pending = account.verification;
    return {
      ...toSummary(account),
      acceptedTermsAt: account.acceptedTermsAt ?? null,
      signupIp: account.signupIp ?? null,
      signupUserAgent: account.signupUserAgent ?? null,
      internalNotes: account.internalNotes ?? '',
      suspendedBy: suspendedBy
        ? { _id: suspendedBy._id.toString(), name: suspendedBy.name, email: suspendedBy.email }
        : null,
      // Timing and attempt count only — never the hashes.
      pendingVerification: pending
        ? {
            sentAt: pending.sentAt,
            expiresAt: pending.expiresAt,
            attempts: pending.attempts,
            maxAttempts: ACCOUNT_VERIFICATION_MAX_ATTEMPTS,
            expired: pending.expiresAt.getTime() <= Date.now(),
          }
        : null,
      activity: activity.map((entry) => ({
        _id: entry._id.toString(),
        action: entry.action,
        adminEmail: entry.adminEmail,
        adminRole: entry.adminRole,
        reason: entry.reason ?? null,
        before: entry.before ?? null,
        after: entry.after ?? null,
        createdAt: entry.createdAt,
      })),
    };
  },

  /**
   * Suspend or reactivate.
   *
   * Suspending also retires any outstanding verification code: a suspended
   * person must not be able to finish registering in the background.
   * Idempotent — asking for the status the account already has changes nothing
   * and writes no audit row.
   */
  async setStatus(
    accountId: string,
    status: AccountStatus,
    admin: IPlatformAdmin,
    reason: string | undefined,
    context: AuditContext = {}
  ) {
    const trimmedReason = reason?.trim();
    if (status === ACCOUNT_STATUSES.SUSPENDED && !trimmedReason) {
      throw AppError.badRequest('A reason is required to suspend an account');
    }

    const update =
      status === ACCOUNT_STATUSES.SUSPENDED
        ? {
            $set: {
              status,
              suspendedAt: new Date(),
              suspendedReason: trimmedReason,
              suspendedBy: admin._id,
            },
            $unset: { verification: 1 },
          }
        : {
            $set: { status },
            $unset: { suspendedAt: 1, suspendedReason: 1, suspendedBy: 1 },
          };

    const result = await Account.updateOne(
      { _id: accountId, status: { $ne: status } },
      update
    );

    if (result.matchedCount === 0) {
      if (!(await Account.exists({ _id: accountId }))) {
        throw AppError.notFound('Account not found');
      }
      return platformAccountsService.getAccount(accountId);
    }

    await recordPlatformAction({
      action:
        status === ACCOUNT_STATUSES.SUSPENDED ? 'account_suspended' : 'account_reactivated',
      admin,
      targetType: AUDIT_TARGET,
      targetId: new Types.ObjectId(accountId),
      reason: trimmedReason,
      before: {
        status:
          status === ACCOUNT_STATUSES.SUSPENDED
            ? ACCOUNT_STATUSES.ACTIVE
            : ACCOUNT_STATUSES.SUSPENDED,
      },
      after: { status },
      ...context,
    });

    return platformAccountsService.getAccount(accountId);
  },

  /**
   * Support override: mark the email verified without a code.
   *
   * This confirms whatever details are pending, so it is for a person whose
   * identity support has established another way. The reason is mandatory and
   * lands in the audit trail.
   */
  async verifyEmail(
    accountId: string,
    admin: IPlatformAdmin,
    reason: string,
    context: AuditContext = {}
  ) {
    const result = await Account.updateOne(
      { _id: accountId, emailVerifiedAt: { $exists: false } },
      {
        $set: { emailVerifiedAt: new Date(), emailVerifiedVia: 'platform_admin' },
        $unset: { verification: 1 },
      }
    );

    if (result.matchedCount === 0) {
      if (!(await Account.exists({ _id: accountId }))) {
        throw AppError.notFound('Account not found');
      }
      throw AppError.conflict('This email is already verified');
    }

    await recordPlatformAction({
      action: 'account_email_verified',
      admin,
      targetType: AUDIT_TARGET,
      targetId: new Types.ObjectId(accountId),
      reason: reason.trim(),
      after: { emailVerifiedVia: 'platform_admin' },
      ...context,
    });

    return platformAccountsService.getAccount(accountId);
  },

  async setNotes(accountId: string, internalNotes: string) {
    const updated = await Account.findByIdAndUpdate(accountId, { internalNotes }, { new: true });
    if (!updated) throw AppError.notFound('Account not found');
    return platformAccountsService.getAccount(accountId);
  },

  /**
   * Permanent erasure.
   *
   * The caller must type the account's email back, which is checked here as
   * well as in the dialog — a stale tab or a scripted call must not delete the
   * wrong person. The audit row keeps only the email's domain: an erased
   * person's address should not survive in the log that records their erasure.
   */
  async deleteAccount(
    accountId: string,
    admin: IPlatformAdmin,
    reason: string,
    confirmEmail: string,
    context: AuditContext = {}
  ) {
    const account = await Account.findById(accountId)
      .select('email status emailVerifiedAt')
      .lean<{ _id: Types.ObjectId; email: string; status: AccountStatus; emailVerifiedAt?: Date }>();
    if (!account) throw AppError.notFound('Account not found');

    if (confirmEmail.trim().toLowerCase() !== account.email) {
      throw AppError.badRequest('The confirmation does not match this account’s email');
    }

    await Account.deleteOne({ _id: account._id });

    await recordPlatformAction({
      action: 'account_deleted',
      admin,
      targetType: AUDIT_TARGET,
      targetId: account._id,
      reason: reason.trim(),
      before: {
        emailDomain: account.email.split('@')[1] ?? null,
        status: account.status,
        verified: Boolean(account.emailVerifiedAt),
      },
      ...context,
    });
  },
};

function toSummary(account: AccountRow) {
  return {
    _id: account._id.toString(),
    name: `${account.firstName} ${account.lastName}`.trim(),
    firstName: account.firstName,
    lastName: account.lastName,
    email: account.email,
    phone: account.phone,
    status: account.status,
    emailVerifiedAt: account.emailVerifiedAt ?? null,
    emailVerifiedVia: account.emailVerifiedVia ?? null,
    suspendedAt: account.suspendedAt ?? null,
    suspendedReason: account.suspendedReason ?? null,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
