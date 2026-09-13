import api, { apiErrorCode, apiErrorMessage } from './api';

/**
 * Self-serve registration of a person — not a company.
 *
 * LeadBee registers the account first and asks "join a team or start your own"
 * afterwards; the reference app instead creates an organization from the
 * signup form. See docs/adr/0003-pre-tenant-accounts.md.
 *
 *   POST /accounts/register             -> register()
 *   POST /accounts/verify-email         -> verify()
 *   POST /accounts/resend-verification  -> resend()
 *
 * The API answers `register` the same way whether or not the email already has
 * an account, so this service never learns that — and neither does the screen.
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
  /** Epoch ms when "send again" is allowed. */
  resendAvailableAt: number;
  /** Development builds only — the API sends it because no email goes out yet. */
  devCode?: string;
}

/** A failure a person can act on: the message is shown to them verbatim. */
export class RegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistrationError';
  }
}

interface ReceiptPayload {
  email: string;
  registrationToken?: string;
  expiresAt: string;
  resendAvailableAt: string;
  devCode?: string;
}

interface Envelope<T> {
  success: true;
  data: T;
}

/**
 * The token for the attempt in progress, per email.
 *
 * In memory, never persisted. The token is what lets a code confirm *this*
 * registration and no other, so it should not outlive the app session; after a
 * restart the person registers again, which issues a fresh one.
 */
const attempts = new Map<string, { token: string; devCode?: string }>();

const keyOf = (email: string) => email.trim().toLowerCase();

const expired = () =>
  new RegistrationError('This registration has expired. Please sign up again.');

function toPending(receipt: ReceiptPayload): PendingVerification {
  return {
    email: receipt.email,
    expiresAt: Date.parse(receipt.expiresAt),
    resendAvailableAt: Date.parse(receipt.resendAvailableAt),
    ...(__DEV__ && receipt.devCode ? { devCode: receipt.devCode } : {}),
  };
}

function toRegistrationError(error: unknown, fallback: string): RegistrationError {
  if (apiErrorCode(error) === 'RATE_LIMITED') {
    return new RegistrationError('Too many attempts. Please wait a few minutes and try again.');
  }
  return new RegistrationError(apiErrorMessage(error, fallback));
}

export const registrationService = {
  /** Creates the account and starts email verification. */
  async register(input: RegisterInput): Promise<PendingVerification> {
    try {
      const { data } = await api.post<Envelope<ReceiptPayload>>('/accounts/register', {
        ...input,
        // The form's own schema refuses to submit until the box is ticked, so
        // reaching this call means consent was given.
        acceptedTerms: true,
      });
      const receipt = data.data;
      if (receipt.registrationToken) {
        attempts.set(keyOf(receipt.email), {
          token: receipt.registrationToken,
          devCode: receipt.devCode,
        });
      }
      return toPending(receipt);
    } catch (error) {
      throw toRegistrationError(error, 'We could not create your account. Please try again.');
    }
  },

  /** Confirms the emailed code. Resolves on success, throws with a reason otherwise. */
  async verify(email: string, code: string): Promise<void> {
    const attempt = attempts.get(keyOf(email));
    if (!attempt) throw expired();

    try {
      await api.post('/accounts/verify-email', {
        email,
        code,
        registrationToken: attempt.token,
      });
      attempts.delete(keyOf(email));
    } catch (error) {
      throw toRegistrationError(error, 'That code is not right. Check the email and try again.');
    }
  },

  /** Issues a fresh code, replacing any still outstanding. */
  async resend(email: string): Promise<PendingVerification> {
    const attempt = attempts.get(keyOf(email));
    if (!attempt) throw expired();

    try {
      const { data } = await api.post<Envelope<ReceiptPayload>>(
        '/accounts/resend-verification',
        { email, registrationToken: attempt.token }
      );
      // Inside the cooldown the old code stays valid and none comes back.
      if (data.data.devCode) attempt.devCode = data.data.devCode;
      return toPending(data.data);
    } catch (error) {
      throw toRegistrationError(error, 'We could not send a new code. Please try again.');
    }
  },

  /** The current code for a development build, so the flow can be tapped through. */
  devCodeFor(email: string): string | undefined {
    return __DEV__ ? attempts.get(keyOf(email))?.devCode : undefined;
  },

  codeLength: 6,
};
