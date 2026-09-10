import { isValidPhoneNumber, parsePhoneNumber, type CountryCode } from 'libphonenumber-js/max';

export const DEFAULT_PHONE_COUNTRY: CountryCode = 'IN';

export interface PhoneValidationResult {
  valid: boolean;
  e164?: string;
  message?: string;
}

export function validatePhone(value: string, country: CountryCode = DEFAULT_PHONE_COUNTRY): PhoneValidationResult {
  const input = value.trim();
  if (!input) return { valid: false, message: 'Phone number is required' };

  if (!isValidPhoneNumber(input, country)) {
    return { valid: false, message: `Enter a valid ${country === 'IN' ? 'Indian' : ''} phone number` };
  }

  const parsed = parsePhoneNumber(input, country);
  if (!parsed) return { valid: false, message: 'Enter a valid phone number' };

  return { valid: true, e164: parsed.number };
}

export function normalizePhone(value: string, country: CountryCode = DEFAULT_PHONE_COUNTRY): string | null {
  return validatePhone(value, country).e164 ?? null;
}
