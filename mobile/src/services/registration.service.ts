/**
 * Self-serve registration — **stub implementation**.
 *
 * LeadBee registers a *person*, not a company. That is the deliberate
 * difference from the reference app, which creates an organization on the
 * signup form itself (it asks for Company Name and GST there). Here the
 * account exists first and the organization question — join an existing one,
 * or start your own — is asked afterwards.
 *
 * Nothing here talks to the API yet. The server has no endpoint for a
 * person-without-an-organization: `User` is tenant-owned, `organizationId` is
 * required by the tenant plugin, and uniqueness is scoped per organization, so
 * a registered-but-unplaced person cannot be a `User` row. That needs a
 * pre-tenant `Account` record and an ADR, which is separate work.
 *
 * Until then this module fakes the three calls the screens need, with the
 * shapes the real endpoints should have:
 *
 *   POST /auth/register              -> register()
 *   POST /auth/verify-email          -> verify()
 *   POST /auth/resend-verification   -> resend()
 *
 * Swapping in the real API should mean replacing the bodies below and nothing
 * in the screens.
 */

export interface RegisterInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
}

export interface PendingVerification {
  email: string;
  /** Epoch ms after which the code stops working. */
  expiresAt: number;
  /**
   * The code, returned only because no mail is actually sent yet. The real
   * endpoint must never return this — the whole point of the step is that
   * only the mailbox owner learns it. Screens show it in `__DEV__` alone.
   */
  devCode?: string;
}

/** A failure a person can act on: the message is shown to them verbatim. */
export class RegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistrationError';
  }
}

// ─── Stub state ───────────────────────────────────────────────────────────────
// Module-level, so it survives navigation between the two screens but not an
// app restart. That is the right lifetime for something pretending to be a
// server: nothing here should look durable.

const CODE_LENGTH = 6;
const CODE_TTL_MS = 10 * 60 * 1000;
const FAKE_LATENCY_MS = 700;

/** Fixed, not random — a code you have to guess is no use without a mailbox. */
const STUB_CODE = '123456';

/** Seeded so the "this email is already registered" path can be demonstrated. */
const TAKEN_EMAILS = new Set(['taken@leadbee.app']);

interface StubRecord {
  input: RegisterInput;
  code: string;
  expiresAt: number;
  verified: boolean;
}

const pending = new Map<string, StubRecord>();

const key = (email: string) => email.trim().toLowerCase();
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const registrationService = {
  /** Creates the account and starts email verification. */
  async register(input: RegisterInput): Promise<PendingVerification> {
    await wait(FAKE_LATENCY_MS);

    const email = key(input.email);
    if (TAKEN_EMAILS.has(email)) {
      throw new RegistrationError('That email already has an account. Try signing in instead.');
    }

    const record: StubRecord = {
      input,
      code: STUB_CODE,
      expiresAt: Date.now() + CODE_TTL_MS,
      verified: false,
    };
    pending.set(email, record);

    return { email: input.email.trim(), expiresAt: record.expiresAt, devCode: record.code };
  },

  /** Confirms the emailed code. Resolves on success, throws with a reason otherwise. */
  async verify(email: string, code: string): Promise<void> {
    await wait(FAKE_LATENCY_MS);

    const record = pending.get(key(email));
    if (!record) {
      throw new RegistrationError('That registration has expired. Please sign up again.');
    }
    if (Date.now() > record.expiresAt) {
      throw new RegistrationError('This code has expired. Send yourself a new one.');
    }
    if (code.trim() !== record.code) {
      throw new RegistrationError('That code is not right. Check the email and try again.');
    }

    record.verified = true;
    TAKEN_EMAILS.add(key(email));
  },

  /** Issues a fresh code, replacing any still outstanding. */
  async resend(email: string): Promise<PendingVerification> {
    await wait(FAKE_LATENCY_MS);

    const record = pending.get(key(email));
    if (!record) {
      throw new RegistrationError('That registration has expired. Please sign up again.');
    }

    record.code = STUB_CODE;
    record.expiresAt = Date.now() + CODE_TTL_MS;
    return { email, expiresAt: record.expiresAt, devCode: record.code };
  },

  codeLength: CODE_LENGTH,
};
