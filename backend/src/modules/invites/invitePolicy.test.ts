import { describe, expect, it } from 'vitest';
import { AppError } from '../../lib/errors.js';
import {
  INVITE_ERROR,
  assertLinkRole,
  codeIsOpen,
  digestsMatch,
  formatJoinCode,
  generateInviteToken,
  generateJoinCode,
  hashInviteToken,
  invalidCode,
  inviteIsOpen,
  looksLikeJoinCode,
  normalizeJoinCode,
} from './invitePolicy.js';

const NOW = new Date('2026-09-24T10:00:00Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);

describe('join codes', () => {
  it('avoids the characters people mistype — 0/O, 1/I/L, 2/Z, 5/S, 8/B', () => {
    const confusable = /[01258BILOSZ]/;
    for (let i = 0; i < 200; i += 1) {
      expect(generateJoinCode()).not.toMatch(confusable);
    }
  });

  it('is eight characters, shown in two groups', () => {
    const code = generateJoinCode();
    expect(code).toHaveLength(8);
    expect(formatJoinCode(code)).toBe(`${code.slice(0, 4)}-${code.slice(4)}`);
  });

  it('does not repeat itself', () => {
    const codes = new Set(Array.from({ length: 500 }, generateJoinCode));
    expect(codes.size).toBe(500);
  });

  it('accepts whatever a person actually pastes', () => {
    const code = 'K7QMXR94';
    for (const typed of [
      'K7QM-XR94',
      'k7qm-xr94',
      '  K7QM XR94 ',
      'https://leadbee.app/join/K7QM-XR94',
      'leadbee://join/k7qmxr94',
    ]) {
      expect(normalizeJoinCode(typed)).toBe(code);
    }
  });

  it('recognises a complete code', () => {
    expect(looksLikeJoinCode('K7QM-XR94')).toBe(true);
    expect(looksLikeJoinCode('K7QM')).toBe(false);
  });
});

describe('codeIsOpen', () => {
  const base = { isActive: true, uses: 0 };

  it('is open while active, unexpired and under its limit', () => {
    expect(codeIsOpen({ ...base, expiresAt: later(1000), maxUses: 5 }, NOW)).toBe(true);
  });

  it('closes when revoked', () => {
    expect(codeIsOpen({ ...base, isActive: false }, NOW)).toBe(false);
  });

  it('closes at the expiry, not after it', () => {
    expect(codeIsOpen({ ...base, expiresAt: NOW }, NOW)).toBe(false);
  });

  it('closes when the use limit is reached', () => {
    expect(codeIsOpen({ ...base, uses: 5, maxUses: 5 }, NOW)).toBe(false);
    expect(codeIsOpen({ ...base, uses: 4, maxUses: 5 }, NOW)).toBe(true);
  });

  it('treats no expiry and no limit as unlimited', () => {
    expect(codeIsOpen({ ...base, uses: 900 }, NOW)).toBe(true);
  });
});

describe('inviteIsOpen', () => {
  it('is open only while pending and unexpired', () => {
    expect(inviteIsOpen({ status: 'pending', expiresAt: later(1) }, NOW)).toBe(true);
    expect(inviteIsOpen({ status: 'pending', expiresAt: NOW }, NOW)).toBe(false);
    for (const status of ['accepted', 'revoked', 'expired']) {
      expect(inviteIsOpen({ status, expiresAt: later(1000) }, NOW)).toBe(false);
    }
  });
});

describe('invitation tokens', () => {
  it('stores a digest, never the token', () => {
    const { token, tokenHash } = generateInviteToken();
    expect(tokenHash).toHaveLength(64);
    expect(tokenHash).not.toContain(token);
    expect(hashInviteToken(token)).toBe(tokenHash);
  });

  it('gives every invitation its own token', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateInviteToken().token));
    expect(tokens.size).toBe(200);
  });

  it('compares digests without leaking where they differ', () => {
    const { token, tokenHash } = generateInviteToken();
    expect(digestsMatch(hashInviteToken(token), tokenHash)).toBe(true);
    expect(digestsMatch(hashInviteToken('something else'), tokenHash)).toBe(false);
    // Different lengths must be false rather than throw.
    expect(digestsMatch('short', tokenHash)).toBe(false);
  });
});

describe('assertLinkRole', () => {
  it('allows the working roles', () => {
    expect(() => assertLinkRole('user')).not.toThrow();
    expect(() => assertLinkRole('partner')).not.toThrow();
  });

  it('refuses to hand out an organizer role through a link', () => {
    for (const role of ['manager', 'admin', 'owner']) {
      expect(() => assertLinkRole(role)).toThrow(AppError);
    }
  });

  it('refuses a role that does not exist', () => {
    expect(() => assertLinkRole('superuser')).toThrow(AppError);
  });
});

describe('invalidCode', () => {
  it('says the same thing whatever was wrong, so guessing learns nothing', () => {
    const error = invalidCode();
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe(INVITE_ERROR.INVALID_CODE);
  });
});
