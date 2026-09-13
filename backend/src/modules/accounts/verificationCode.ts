import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Email verification codes and registration tokens — the pure part.
 *
 * Kept free of the database and of `env` so the rules that decide whether a
 * code is still good are unit-testable on their own. The service supplies the
 * key and the stored state.
 */

export const VERIFICATION_CODE_LENGTH = 6;
export const VERIFICATION_CODE_TTL_MS = 10 * 60 * 1000;
/** Guesses allowed per code. Six digits and five tries is a 1-in-200,000 shot. */
export const VERIFICATION_MAX_ATTEMPTS = 5;
export const VERIFICATION_RESEND_COOLDOWN_MS = 30 * 1000;

/** Uniformly random, zero-padded — `randomInt`, never `Math.random`. */
export function generateCode(): string {
  return randomInt(0, 10 ** VERIFICATION_CODE_LENGTH)
    .toString()
    .padStart(VERIFICATION_CODE_LENGTH, '0');
}

/** 256 bits, URL-safe. Identifies one registration attempt. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Keyed hash for storage.
 *
 * A plain SHA-256 of a six-digit code is no protection at all: there are only
 * a million of them, so a leaked row is reversed instantly. With a server-side
 * key the stored value is useless without that key as well.
 */
export function hashSecret(value: string, key: Buffer | string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

/** Constant-time comparison of two hex digests. Unequal lengths never match. */
export function secretsMatch(candidate: string, stored: string): boolean {
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(stored, 'hex');
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function resendAvailableAt(sentAt: Date): Date {
  return new Date(sentAt.getTime() + VERIFICATION_RESEND_COOLDOWN_MS);
}

export function canResend(sentAt: Date, now: Date): boolean {
  return now.getTime() >= resendAvailableAt(sentAt).getTime();
}
