import { Types, type ClientSession } from 'mongoose';
import bcrypt from 'bcryptjs';
import {
  Account,
  ACCOUNT_STATUSES,
  type IAccount,
} from '../../models/Account.js';
import { User } from '../../models/User.js';
import { AppError } from '../../lib/errors.js';
import { withoutTenantScope } from '../../lib/tenantContext.js';
import {
  joinName,
  resolveIdentity,
  splitName,
  type IdentityCandidate,
  type IdentityConflictReason,
  type IdentityResolution,
} from './identity.js';

/**
 * One person, one account — applied to the database.
 *
 * The account owns the person's name, email, mobile number and password. Every
 * organization they belong to holds a membership (`User`) that points at the
 * account and keeps a read-only copy of the name, email and mobile, because
 * lead, task and notification queries populate those from the membership. That
 * copy is written here and nowhere else.
 *
 * Several functions read or write memberships across organizations. Each call
 * is `withoutTenantScope` with its reason, and each is listed in ADR-0004
 * (ARCH-4): one person's memberships live in different tenants by definition.
 */

type ConflictCode = IdentityConflictReason | 'ACCOUNT_EXISTS';

const CONFLICT_MESSAGES: Record<ConflictCode, string> = {
  EMAIL_IN_USE: 'This email is already linked to a different mobile number.',
  PHONE_IN_USE: 'This mobile number is already linked to a different email.',
  IDENTITY_CONFLICT: 'This email and mobile number are already linked to other accounts.',
  ACCOUNT_EXISTS: 'An account with this email and mobile number already exists. Sign in instead.',
};

export function identityConflict(code: ConflictCode): AppError {
  return new AppError(CONFLICT_MESSAGES[code], 409, code);
}

/** The membership's copy of the person, derived from the account. */
export function membershipCopy(account: Pick<IAccount, 'firstName' | 'lastName' | 'email' | 'phone'>) {
  return {
    name: joinName(account.firstName, account.lastName),
    email: account.email,
    phone: account.phone,
  };
}

/** A duplicate-key error on an account, reported as the identity it collided on. */
export function duplicateIdentity(error: unknown): AppError | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, keyPattern } = error as { code?: unknown; keyPattern?: Record<string, unknown> };
  if (code !== 11000) return null;
  if (keyPattern?.email) return identityConflict('EMAIL_IN_USE');
  if (keyPattern?.phone) return identityConflict('PHONE_IN_USE');
  return null;
}

export interface IdentityLookup {
  resolution: IdentityResolution;
  byEmail: IAccount | null;
  byPhone: IAccount | null;
}

export interface PersonDetails {
  /** Full name, as a single field. Split into first and last on the account. */
  name: string;
  email: string;
  phone: string;
  /** Required only when a new account has to be created. */
  password?: string;
}

export const identityService = {
  /**
   * What does this email/mobile pair mean?
   *
   * `ignoreAccountId` leaves one account out of the check — the account being
   * edited, which naturally already holds its own identifiers.
   */
  async lookupIdentity(
    email: string,
    phone: string,
    options: { session?: ClientSession; ignoreAccountId?: Types.ObjectId } = {}
  ): Promise<IdentityLookup> {
    const session = options.session ?? null;
    const [foundByEmail, foundByPhone] = await Promise.all([
      Account.findOne({ email: email.trim().toLowerCase() }).select('+verification').session(session),
      Account.findOne({ phone }).select('+verification').session(session),
    ]);

    const skip = (account: IAccount | null) =>
      account && options.ignoreAccountId?.equals(account._id) ? null : account;
    const byEmail = skip(foundByEmail);
    const byPhone = skip(foundByPhone);

    const resolution = resolveIdentity(
      await toCandidate(byEmail, options.session),
      await toCandidate(byPhone, options.session)
    );
    return { resolution, byEmail, byPhone };
  },

  /**
   * Removes unconfirmed self-registrations that a real person has just
   * displaced. Conditioned on still being unconfirmed, so one that got
   * verified a moment ago survives.
   */
  async removeSupersededRegistrations(ids: string[], session?: ClientSession): Promise<void> {
    if (ids.length === 0) return;
    await Account.deleteMany(
      {
        _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
        source: 'registration',
        emailVerifiedAt: { $exists: false },
      },
      { session }
    );
  },

  /**
   * The account a new membership should point at: the person's existing one,
   * or a new one.
   *
   * `requirePasswordOfExisting` is for self-serve signup, where whoever fills in
   * the form must prove they are the existing account's owner before an
   * organization is created in their name. Platform provisioning and team
   * admins link an existing person without it — they act on the person, they do
   * not become them.
   */
  async ensureAccountForMembership(
    person: PersonDetails,
    options: { session?: ClientSession; requirePasswordOfExisting?: boolean } = {}
  ): Promise<{ account: IAccount; created: boolean }> {
    const email = person.email.trim().toLowerCase();
    const { resolution, byEmail } = await identityService.lookupIdentity(email, person.phone, {
      session: options.session,
    });

    if (resolution.kind === 'conflict') throw identityConflict(resolution.reason);

    if (resolution.kind === 'existing') {
      const account = byEmail!;
      if (account.status !== ACCOUNT_STATUSES.ACTIVE) {
        throw AppError.accountSuspended('This person’s LeadBee account is suspended.');
      }
      if (options.requirePasswordOfExisting) {
        const withPassword = await Account.findById(account._id)
          .select('+password')
          .session(options.session ?? null);
        const matches =
          Boolean(withPassword && person.password) &&
          (await bcrypt.compare(person.password!, withPassword!.password));
        if (!matches) throw identityConflict('ACCOUNT_EXISTS');
      }
      return { account, created: false };
    }

    if (!person.password) {
      throw AppError.badRequest('A password is required to create an account for this person.');
    }

    await identityService.removeSupersededRegistrations(resolution.supersede, options.session);

    const { firstName, lastName } = splitName(person.name);
    try {
      const [account] = await Account.create(
        [
          {
            firstName,
            lastName,
            email,
            phone: person.phone,
            password: person.password,
            status: ACCOUNT_STATUSES.ACTIVE,
            source: 'organization',
          },
        ],
        { session: options.session }
      );
      return { account: account!, created: true };
    } catch (error) {
      throw duplicateIdentity(error) ?? error;
    }
  },

  /**
   * Change who the person is: name, email, mobile.
   *
   * Every membership's copy follows. A changed email is no longer a confirmed
   * one, so its verification is cleared.
   */
  async updateIdentity(
    accountId: Types.ObjectId,
    changes: { name?: string; email?: string; phone?: string }
  ): Promise<IAccount> {
    const account = await Account.findById(accountId).select('+verification');
    if (!account) throw AppError.notFound('Account not found');

    const nextEmail =
      changes.email !== undefined ? changes.email.trim().toLowerCase() : account.email;
    const nextPhone = changes.phone !== undefined ? changes.phone : account.phone;
    if (!nextEmail) throw AppError.badRequest('Email is required — it is how this person signs in.');

    const emailChanged = nextEmail !== account.email;
    const phoneChanged = nextPhone !== account.phone;

    if (emailChanged || phoneChanged) {
      const { resolution } = await identityService.lookupIdentity(nextEmail, nextPhone, {
        ignoreAccountId: account._id,
      });
      if (resolution.kind === 'conflict') throw identityConflict(resolution.reason);
      if (resolution.kind === 'existing') throw identityConflict('IDENTITY_CONFLICT');
      await identityService.removeSupersededRegistrations(resolution.supersede);
    }

    if (changes.name !== undefined) {
      const { firstName, lastName } = splitName(changes.name);
      if (!firstName) throw AppError.badRequest('Name is required');
      account.firstName = firstName;
      account.lastName = lastName;
    }
    if (emailChanged) {
      account.email = nextEmail;
      account.emailVerifiedAt = undefined;
      account.emailVerifiedVia = undefined;
      account.verification = undefined;
    }
    if (phoneChanged) account.phone = nextPhone;

    try {
      await account.save();
    } catch (error) {
      throw duplicateIdentity(error) ?? error;
    }

    await identityService.syncMembershipCopies(account);
    return account;
  },

  async syncMembershipCopies(account: IAccount): Promise<void> {
    await withoutTenantScope(
      'identity: keep every membership copy of name, email and mobile in step with the account',
      () => User.updateMany({ accountId: account._id }, { $set: membershipCopy(account) }).exec()
    );
  },

  /**
   * Refuses when the person belongs to any other organization.
   *
   * One organization's admin must not change a name, email or password that
   * another organization's people rely on to reach the same person.
   */
  async assertSoleMembership(
    accountId: Types.ObjectId,
    organizationId: Types.ObjectId,
    action: string
  ): Promise<void> {
    const organizationIds = (await withoutTenantScope(
      'identity: which organizations this person belongs to',
      () => User.distinct('organizationId', { accountId }).exec()
    )) as Types.ObjectId[];

    if (organizationIds.some((id) => !id.equals(organizationId))) {
      throw AppError.conflict(
        `This person also belongs to other organizations, so only they can ${action}.`
      );
    }
  },

  async verifyPassword(accountId: Types.ObjectId, candidate: string): Promise<boolean> {
    const account = await Account.findById(accountId).select('+password');
    return account ? bcrypt.compare(candidate, account.password) : false;
  },

  /** Sets the one password and ends every session the person holds, everywhere. */
  async setPassword(accountId: Types.ObjectId, password: string): Promise<void> {
    const account = await Account.findById(accountId).select('+password');
    if (!account) throw AppError.notFound('Account not found');
    account.password = password;
    await account.save();
    await identityService.revokeSessions(accountId);
  },

  /** Every session: each membership's, and the account session held with none. */
  async revokeSessions(accountId: Types.ObjectId): Promise<void> {
    await withoutTenantScope(
      'identity: end this person’s sessions in every organization',
      () => User.updateMany({ accountId }, { $set: { refreshTokens: [] } }).exec()
    );
    await Account.updateOne({ _id: accountId }, { $set: { refreshTokens: [] } });
  },
};

async function toCandidate(
  account: IAccount | null,
  session?: ClientSession
): Promise<IdentityCandidate | null> {
  if (!account) return null;
  const disposable =
    account.source === 'registration' &&
    !account.emailVerifiedAt &&
    !(await hasMemberships(account._id, session));
  return { id: account._id.toString(), disposable };
}

async function hasMemberships(accountId: Types.ObjectId, session?: ClientSession): Promise<boolean> {
  const found = await withoutTenantScope(
    'identity: whether an account belongs to any organization',
    () => User.exists({ accountId }).session(session ?? null).exec()
  );
  return found !== null;
}
