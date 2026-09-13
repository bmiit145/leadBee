import { createHash } from 'node:crypto';
import {
  Account,
  ACCOUNT_STATUSES,
  type IAccount,
  type PendingVerification,
} from '../../models/Account.js';
import { AppError } from '../../lib/errors.js';
import { mailer } from '../../lib/mailer.js';
import { env } from '../../config/env.js';
import {
  VERIFICATION_CODE_TTL_MS,
  VERIFICATION_MAX_ATTEMPTS,
  canResend,
  generateCode,
  generateToken,
  hashSecret,
  resendAvailableAt,
  secretsMatch,
} from './verificationCode.js';
import { duplicateIdentity, identityConflict, identityService } from './identity.service.js';

/**
 * Self-serve registration of a person, and confirmation of their email.
 *
 * Properties this is built to hold:
 *
 * 1. **An email and a mobile number each belong to one person.** Registering
 *    an identifier already tied to someone else is refused with a reason
 *    (ADR-0004). That tells the caller the identifier is taken — a trade-off
 *    the product chose, bounded by the rate limits on these routes.
 * 2. **An unconfirmed registration reserves nothing.** A newer registration
 *    for the same email or mobile replaces it, so nobody can lock a person out
 *    of LeadBee by registering their details first.
 * 3. **A code cannot be brute-forced.** Guesses are spent atomically before the
 *    comparison, so five concurrent requests cannot share one attempt.
 * 4. **A code confirms the attempt that requested it.** Each registration gets a
 *    token; verifying needs the token *and* the code. Verify and resend still
 *    answer uniformly, so they reveal nothing beyond what register already does.
 *
 * See docs/adr/0003-pre-tenant-accounts.md and docs/adr/0004-account-is-the-identity.md.
 */

export const ACCOUNT_VERIFICATION_MAX_ATTEMPTS = VERIFICATION_MAX_ATTEMPTS;

export interface RegistrationDetails {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
}

export interface RegistrationContext {
  ip?: string;
  userAgent?: string;
}

export interface RegistrationReceipt {
  email: string;
  /** Present on `register` only. Required to verify and to resend. */
  registrationToken?: string;
  expiresAt: string;
  resendAvailableAt: string;
  /**
   * The code itself, only outside production, because no mail is delivered
   * yet. A production response must never carry this.
   */
  devCode?: string;
}

export interface VerificationAttempt {
  email: string;
  code: string;
  registrationToken: string;
}

/**
 * HMAC key for codes and tokens, derived from an existing secret with a label
 * so it is never the JWT key itself. Rotating `JWT_SECRET` invalidates
 * outstanding codes, which is harmless: they last ten minutes.
 */
const VERIFICATION_KEY = createHash('sha256')
  .update(`leadbee:account-verification:v1:${env.JWT_SECRET}`)
  .digest();

const USER_AGENT_MAX = 300;

const hash = (value: string): string => hashSecret(value, VERIFICATION_KEY);

export const accountService = {
  async register(
    details: RegistrationDetails,
    context: RegistrationContext = {}
  ): Promise<RegistrationReceipt> {
    if (!env.ALLOW_SELF_SERVE_SIGNUP) {
      throw AppError.forbidden('Self-serve registration is disabled.');
    }
    // Before any write: a missing mail setup must not leave accounts nobody can verify.
    mailer.assertConfigured();

    const now = new Date();
    const { resolution, byEmail } = await identityService.lookupIdentity(
      details.email,
      details.phone
    );

    if (resolution.kind === 'conflict') throw identityConflict(resolution.reason);

    if (resolution.kind === 'existing') {
      // The same person retrying an unconfirmed registration carries on with a
      // fresh token. Anyone with a real account is sent to sign in.
      if (!resolution.disposable) throw identityConflict('ACCOUNT_EXISTS');
      return continueRegistration(byEmail!, details, context, now);
    }

    await identityService.removeSupersededRegistrations(resolution.supersede);
    try {
      return await createRegistration(details, context, now);
    } catch (error) {
      // Two submissions for one new identity can both miss the lookup above; the
      // unique indexes let exactly one through, and the other hears why.
      throw duplicateIdentity(error) ?? error;
    }
  },

  async verifyEmail(attempt: VerificationAttempt): Promise<{ email: string; verifiedAt: string }> {
    const now = new Date();

    // Spend a guess first, atomically, and only against a live attempt this
    // caller holds the token for. A caller without the token cannot burn the
    // real registrant's guesses; a caller with it gets five, however many
    // requests they fire at once.
    const spent = await Account.findOneAndUpdate(
      {
        email: attempt.email,
        status: ACCOUNT_STATUSES.ACTIVE,
        emailVerifiedAt: { $exists: false },
        'verification.tokenHash': hash(attempt.registrationToken),
        'verification.expiresAt': { $gt: now },
        'verification.attempts': { $lt: VERIFICATION_MAX_ATTEMPTS },
      },
      { $inc: { 'verification.attempts': 1 } },
      { new: true }
    ).select('+verification');

    const stored = spent?.verification;
    // Every failure is the same answer: wrong code, expired, out of guesses,
    // unknown address, already verified.
    if (!spent || !stored || !secretsMatch(hash(attempt.code), stored.codeHash)) {
      throw invalidCode();
    }

    // Conditioned on the code still being the one just checked, so a resend or
    // re-registration that landed in between wins rather than being overwritten.
    const confirmed = await Account.updateOne(
      { _id: spent._id, 'verification.codeHash': stored.codeHash },
      {
        $set: { emailVerifiedAt: now, emailVerifiedVia: 'code' },
        $unset: { verification: 1 },
      }
    );
    if (confirmed.modifiedCount === 0) throw invalidCode();

    return { email: spent.email, verifiedAt: now.toISOString() };
  },

  async resendVerification(email: string, registrationToken: string): Promise<RegistrationReceipt> {
    mailer.assertConfigured();
    const now = new Date();

    const account = await Account.findOne({ email }).select('+verification');
    const current = account?.verification;
    const eligible =
      account?.status === ACCOUNT_STATUSES.ACTIVE &&
      !account.emailVerifiedAt &&
      current !== undefined &&
      secretsMatch(hash(registrationToken), current.tokenHash);

    if (!account || !current || !eligible) {
      return receipt(email, syntheticWindow(now));
    }
    if (!canResend(current.sentAt, now)) {
      return receipt(email, current);
    }

    const code = generateCode();
    const next: PendingVerification = {
      codeHash: hash(code),
      tokenHash: current.tokenHash,
      expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL_MS),
      attempts: 0,
      sentAt: now,
    };

    // Conditioned on `sentAt`, so two taps on "send again" send one email.
    const rotated = await Account.updateOne(
      { _id: account._id, 'verification.sentAt': current.sentAt },
      { $set: { verification: next } }
    );
    if (rotated.modifiedCount === 0) return receipt(email, current);

    await sendCode(account, code);
    return receipt(email, next, { code });
  },
};

// ─── Registration paths ───────────────────────────────────────────────────────

async function createRegistration(
  details: RegistrationDetails,
  context: RegistrationContext,
  now: Date
): Promise<RegistrationReceipt> {
  const code = generateCode();
  const token = generateToken();
  const pending = newPending(code, token, now);

  const account = await Account.create({
    ...details,
    status: ACCOUNT_STATUSES.ACTIVE,
    source: 'registration',
    acceptedTermsAt: now,
    signupIp: context.ip,
    signupUserAgent: context.userAgent?.slice(0, USER_AGENT_MAX),
    verification: pending,
  });

  await sendCode(account, code);
  return receipt(account.email, pending, { token, code });
}

/**
 * The same email and mobile, still unconfirmed: the newest submission's details
 * replace the pending ones and get a new token, so only the latest attempt can
 * confirm.
 */
async function continueRegistration(
  account: IAccount,
  details: RegistrationDetails,
  context: RegistrationContext,
  now: Date
): Promise<RegistrationReceipt> {
  const token = generateToken();
  const current = account.verification;
  // Inside the resend cooldown the existing code stays valid and no second
  // email goes out — a double tap on "Create account" should not mail twice.
  const keepCode =
    current !== undefined && current.expiresAt > now && !canResend(current.sentAt, now);

  let code: string | undefined;
  let pending: PendingVerification;
  if (keepCode && current) {
    pending = {
      codeHash: current.codeHash,
      tokenHash: hash(token),
      expiresAt: current.expiresAt,
      attempts: current.attempts,
      sentAt: current.sentAt,
    };
  } else {
    code = generateCode();
    pending = newPending(code, token, now);
  }

  account.firstName = details.firstName;
  account.lastName = details.lastName;
  account.password = details.password;
  account.acceptedTermsAt = now;
  account.signupIp = context.ip;
  account.signupUserAgent = context.userAgent?.slice(0, USER_AGENT_MAX);
  account.verification = pending;
  await account.save();

  if (code) await sendCode(account, code);
  return receipt(account.email, pending, { token, code });
}

// ─── Mail ─────────────────────────────────────────────────────────────────────

async function sendCode(account: Pick<IAccount, 'email' | 'firstName'>, code: string) {
  await mailer.send({
    to: account.email,
    subject: 'Your LeadBee verification code',
    text:
      `Hi ${account.firstName},\n\n` +
      `Your LeadBee verification code is ${code}. It expires in 10 minutes.\n\n` +
      'If you did not create a LeadBee account, you can ignore this email.',
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function invalidCode(): AppError {
  return new AppError(
    'That code is invalid or has expired. Request a new code and try again.',
    400,
    'INVALID_VERIFICATION_CODE'
  );
}

function newPending(code: string, token: string, now: Date): PendingVerification {
  return {
    codeHash: hash(code),
    tokenHash: hash(token),
    expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL_MS),
    attempts: 0,
    sentAt: now,
  };
}

/** The window a caller would see for a code sent right now. */
function syntheticWindow(now: Date): { expiresAt: Date; sentAt: Date } {
  return { expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL_MS), sentAt: now };
}

function receipt(
  email: string,
  window: { expiresAt: Date; sentAt: Date },
  extras: { token?: string; code?: string } = {}
): RegistrationReceipt {
  return {
    email,
    ...(extras.token ? { registrationToken: extras.token } : {}),
    expiresAt: window.expiresAt.toISOString(),
    resendAvailableAt: resendAvailableAt(window.sentAt).toISOString(),
    ...(extras.code && !env.isProduction ? { devCode: extras.code } : {}),
  };
}
