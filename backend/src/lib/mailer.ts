import { env } from '../config/env.js';
import { logger } from './logger.js';
import { AppError } from './errors.js';

/**
 * Outbound email.
 *
 * **There is no real transport yet.** SMTP / provider credentials have not been
 * supplied, so outside production messages are recorded as "would have sent"
 * and not delivered. Registration still works end to end in development because
 * the API returns the verification code to non-production callers.
 *
 * In production the log transport **refuses** rather than pretending. A
 * registration flow that silently drops its verification email produces
 * accounts nobody can ever verify, and nobody notices until customers complain.
 * Failing closed makes the missing configuration an error at the first attempt.
 *
 * Adding a real provider is an external dependency, so it needs an ADR
 * (ARCHITECTURE-RULES "ADR process"); it replaces `send` below and nothing else.
 */

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain text. May contain a one-time code, so it is never logged. */
  text: string;
}

/** `asha.mehta@example.com` → `a***@example.com` — enough to trace, not to harvest. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

export const mailer = {
  /** Whether messages can be accepted at all in this environment. */
  isConfigured(): boolean {
    return !env.isProduction;
  },

  /** Throws a 503 before any work is done when mail cannot be sent. */
  assertConfigured(): void {
    if (!mailer.isConfigured()) {
      throw new AppError(
        'Email delivery is not configured, so new registrations cannot be verified right now.',
        503,
        'EMAIL_UNAVAILABLE'
      );
    }
  },

  async send(message: MailMessage): Promise<void> {
    mailer.assertConfigured();
    logger.info(
      { to: maskEmail(message.to), subject: message.subject, transport: 'log' },
      'email not delivered: no mail transport configured'
    );
  },
};
