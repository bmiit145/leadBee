import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  Account,
  ACCOUNT_STATUSES,
  type IAccount,
  type PendingVerification,
} from '../../models/Account.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { mailer, maskEmail } from '../../lib/mailer.js';
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

/**
 * Self-serve registration of a person, and confirmation of their email.
 *
 * Three properties this is built to hold:
 *
 * 1. **It is not an email oracle.** `register` and `resend` answer in the same
 *    shape, and at comparable cost, whether or not the address already has an
 *    account. Otherwise the form becomes a free way to test which of a
 *    competitor's staff use LeadBee.
 * 2. **A code cannot be brute-forced.** Guesses are spent atomically before
 *    the comparison, so five concurrent requests cannot share one attempt.
 * 3. **A code confirms the attempt that requested it.** Each registration gets
 *    a token; verifying needs the token *and* the code. Without this, someone
 *    who pre-registers a victim's address with their own password could wait
 *    for the victim to confirm the mailbox and inherit a verified account.
 *
 * See docs/adr/0003-pre-tenant-accounts.md.
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

const BCRYPT_COST = 12;
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
    // Checked before any write, and on every path, so a missing mail setup is
    // the same answer for an address that exists and one that does not.
    mailer.assertConfigured();

    const now = new Date();
    const existing = await Account.findOne({ email: details.email }).select('+verification');
    if (existing) return continueRegistration(existing, details, context, now);

    try {
      return await createRegistration(details, context, now);
    } catch (error) {
      // Two submissions for one new address can both miss the lookup above; the
      // unique index lets exactly one create through. The other continues as a
      // repeat registration rather than surfacing a 500.
      if (!isDuplicateKey(error)) throw error;
      const raced = await Account.findOne({ email: details.email }).select('+verification');
      if (!raced) throw error;
      return continueRegistration(raced, details, context, now);
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
    // unknown address, already verified. Distinguishing them would tell a
    // prober which addresses are mid-registration.
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
    acceptedTermsAt: now,
    signupIp: context.ip,
    signupUserAgent: context.userAgent?.slice(0, USER_AGENT_MAX),
    verification: pending,
  });

  await sendCode(account, code);
  return receipt(account.email, pending, { token, code });
}

/**
 * The address already has an account.
 *
 * - **Verified, or suspended:** nothing changes. The response is shaped exactly
 *   like a fresh registration, and a password hash is computed and thrown away
 *   so the timing matches too. The owner of a verified address gets a notice.
 * - **Still unverified:** the newest submission replaces the pending details
 *   and receives a new token. Proving the mailbox is what makes an account
 *   real, so the person who can do that should be the one whose details stick.
 */
async function continueRegistration(
  account: IAccount,
  details: RegistrationDetails,
  context: RegistrationContext,
  now: Date
): Promise<RegistrationReceipt> {
  const settled = Boolean(account.emailVerifiedAt) || account.status !== ACCOUNT_STATUSES.ACTIVE;
  if (settled) {
    await bcrypt.hash(details.password, BCRYPT_COST);
    if (account.emailVerifiedAt && account.status === ACCOUNT_STATUSES.ACTIVE) {
      await sendAlreadyRegisteredNotice(account);
    }
    return receipt(details.email, syntheticWindow(now), { token: generateToken() });
  }

  const token = generateToken();
  const current = account.verification;
  // Inside the resend cooldown the existing code stays valid and no second
  // email goes out — a double tap on "Create account" should not mail twice.
  // The token still rotates, so only the latest submission can confirm.
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
  account.phone = details.phone;
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

/**
 * Tells a verified owner that someone tried to register their address.
 *
 * Swallowed on failure: this path must answer exactly like a fresh registration,
 * and a notice that could not be sent is not worth breaking that for.
 */
async function sendAlreadyRegisteredNotice(account: Pick<IAccount, 'email' | 'firstName'>) {
  try {
    await mailer.send({
      to: account.email,
      subject: 'Someone tried to register with your email',
      text:
        `Hi ${account.firstName},\n\n` +
        'Someone just tried to create a LeadBee account with this email address. ' +
        'You already have one, so nothing was changed.\n\n' +
        'If this was you, sign in instead. If not, you can ignore this email.',
    });
  } catch (error) {
    logger.warn(
      { err: error, to: maskEmail(account.email) },
      'already-registered notice not sent'
    );
  }
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

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000
  );
}
