import { describe, expect, it } from 'vitest';
import {
  VERIFICATION_CODE_LENGTH,
  VERIFICATION_RESEND_COOLDOWN_MS,
  canResend,
  generateCode,
  generateToken,
  hashSecret,
  resendAvailableAt,
  secretsMatch,
} from './verificationCode.js';

describe('generateCode', () => {
  it('is always exactly six digits, including leading zeros', () => {
    for (let i = 0; i < 500; i += 1) {
      expect(generateCode()).toMatch(new RegExp(`^\\d{${VERIFICATION_CODE_LENGTH}}$`));
    }
  });

  it('does not repeat itself', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateCode()));
    // A birthday collision or two in a million-space is possible; a stuck
    // generator would produce one value.
    expect(codes.size).toBeGreaterThan(190);
  });
});

describe('generateToken', () => {
  it('is URL-safe and carries 256 bits', () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('is unique per call', () => {
    expect(generateToken()).not.toBe(generateToken());
  });
});

describe('hashSecret', () => {
  it('is deterministic for the same key', () => {
    expect(hashSecret('123456', 'key-a')).toBe(hashSecret('123456', 'key-a'));
  });

  it('depends on the key, so a leaked row cannot be reversed without it', () => {
    expect(hashSecret('123456', 'key-a')).not.toBe(hashSecret('123456', 'key-b'));
  });

  it('never stores the plaintext', () => {
    const digest = hashSecret('123456', 'key-a');
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain('123456');
  });
});

describe('secretsMatch', () => {
  const stored = hashSecret('123456', 'key');

  it('matches the same secret', () => {
    expect(secretsMatch(hashSecret('123456', 'key'), stored)).toBe(true);
  });

  it('rejects a different secret', () => {
    expect(secretsMatch(hashSecret('654321', 'key'), stored)).toBe(false);
  });

  it('rejects mismatched lengths instead of throwing', () => {
    expect(secretsMatch('abcd', stored)).toBe(false);
    expect(secretsMatch('', stored)).toBe(false);
  });
});

describe('resend cooldown', () => {
  const sentAt = new Date('2026-09-13T10:00:00.000Z');

  it('opens exactly when the cooldown ends', () => {
    expect(resendAvailableAt(sentAt).getTime()).toBe(
      sentAt.getTime() + VERIFICATION_RESEND_COOLDOWN_MS
    );
  });

  it('refuses a resend one millisecond early', () => {
    const early = new Date(sentAt.getTime() + VERIFICATION_RESEND_COOLDOWN_MS - 1);
    expect(canResend(sentAt, early)).toBe(false);
  });

  it('allows a resend once the cooldown has passed', () => {
    const onTime = new Date(sentAt.getTime() + VERIFICATION_RESEND_COOLDOWN_MS);
    expect(canResend(sentAt, onTime)).toBe(true);
  });
});
