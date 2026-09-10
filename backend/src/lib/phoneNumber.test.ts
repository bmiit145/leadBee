import { describe, expect, it } from 'vitest';
import { normalizePhoneNumberOrThrow } from './phoneNumber.js';

describe('phone number normalization', () => {
  it('rejects the 9-digit value 898038051', () => {
    expect(() => normalizePhoneNumberOrThrow('898038051', 'IN')).toThrow('valid phone number');
  });

  it('accepts and canonicalizes a valid Indian mobile number', () => {
    expect(normalizePhoneNumberOrThrow('9876543210', 'IN')).toBe('+919876543210');
    expect(normalizePhoneNumberOrThrow('+91 9876543210', 'IN')).toBe('+919876543210');
  });

  it('does not require India when the user supplies an international number', () => {
    expect(normalizePhoneNumberOrThrow('+14155552671')).toBe('+14155552671');
  });
});
