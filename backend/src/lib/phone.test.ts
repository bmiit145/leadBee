import { describe, expect, it } from 'vitest';
import {
  contactPhoneSchema,
  isValidMobilePhone,
  isValidPhone,
  loginPhoneSchema,
  mobilePhoneSchema,
  normalizePhone,
} from './phone.js';

describe('phone validation', () => {
  describe('the reported defect', () => {
    it('rejects 898038051 — nine digits is not a valid Indian mobile number', () => {
      // Accepted by the superadmin dashboard under the old min(6).max(20) rule.
      expect(isValidMobilePhone('898038051')).toBe(false);
      expect(mobilePhoneSchema.safeParse('898038051').success).toBe(false);
    });

    it('accepts the same number once it is ten digits', () => {
      expect(mobilePhoneSchema.parse('8980380510')).toBe('8980380510');
    });

    it('reports a message a superadmin can act on', () => {
      const result = mobilePhoneSchema.safeParse('898038051');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Enter a valid mobile number');
      }
    });
  });

  describe('isValidMobilePhone', () => {
    it.each(['9000000001', '8980380510', '+919000000001', '+91 90000 00001', '90000-00001'])(
      'accepts %s',
      (input) => {
        expect(isValidMobilePhone(input)).toBe(true);
      }
    );

    it.each([
      ['898038051', 'too short'],
      ['90000000012', 'too long'],
      ['5555555555', 'not an allocated mobile prefix'],
      ['0000000000', 'all zeroes'],
      ['abcdefghij', 'not digits'],
      ['', 'empty'],
      ['   ', 'blank'],
      ['1234567890', 'a landline, not a mobile'],
    ])('rejects %s (%s)', (input) => {
      expect(isValidMobilePhone(input)).toBe(false);
    });

    it('accepts a foreign mobile number in full international form', () => {
      expect(isValidMobilePhone('+14155552671')).toBe(true);
    });
  });

  describe('isValidPhone', () => {
    it('accepts a landline, which isValidMobilePhone rejects', () => {
      expect(isValidPhone('1234567890')).toBe(true);
      expect(isValidMobilePhone('1234567890')).toBe(false);
    });

    it('still rejects a number that is not dialable at all', () => {
      expect(isValidPhone('898038051')).toBe(false);
      expect(isValidPhone('abcdefghij')).toBe(false);
    });
  });

  describe('normalizePhone', () => {
    it.each(['9000000001', '+919000000001', '+91 90000 00001', '90000-00001', ' 9000000001 '])(
      'collapses %s onto the stored national form',
      (input) => {
        expect(normalizePhone(input)).toBe('9000000001');
      }
    );

    it('leaves an existing ten-digit row untouched, so no migration is needed', () => {
      expect(normalizePhone('9000000001')).toBe('9000000001');
    });

    it('keeps a foreign number in E.164, where the country code is not optional', () => {
      expect(normalizePhone('+14155552671')).toBe('+14155552671');
    });

    it('returns an unparseable value trimmed rather than throwing', () => {
      // Rows written before this module existed must still be findable.
      expect(normalizePhone('  898038051 ')).toBe('898038051');
      expect(normalizePhone('not-a-number')).toBe('not-a-number');
    });
  });

  describe('mobilePhoneSchema', () => {
    it('normalizes on the way in, so create and login agree on the stored key', () => {
      expect(mobilePhoneSchema.parse('+91 90000 00001')).toBe('9000000001');
    });

    it('rejects a landline where a handset is required', () => {
      expect(mobilePhoneSchema.safeParse('1234567890').success).toBe(false);
    });
  });

  describe('contactPhoneSchema', () => {
    it('allows a landline, because a lead contact is not a credential', () => {
      expect(contactPhoneSchema.parse('1234567890')).toBe('1234567890');
    });

    it('still rejects a value that is not a phone number', () => {
      expect(contactPhoneSchema.safeParse('898038051').success).toBe(false);
      expect(contactPhoneSchema.safeParse('abc').success).toBe(false);
    });
  });

  describe('loginPhoneSchema', () => {
    it('normalizes so a formatted entry reaches the stored row', () => {
      expect(loginPhoneSchema.parse('+91 90000 00001')).toBe('9000000001');
    });

    it('does not validate, so a legacy account is not locked out', () => {
      // Created before this rule existed. It must still be possible to look the
      // row up; the credential check is what decides the outcome.
      expect(loginPhoneSchema.parse('898038051')).toBe('898038051');
    });
  });
});
