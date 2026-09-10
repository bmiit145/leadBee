import {
  getCountryCallingCode,
  isValidPhoneNumber,
  parsePhoneNumberWithError,
  type CountryCode,
} from 'libphonenumber-js/max';

export interface NormalizedPhoneNumber {
  e164: string;
  country: CountryCode | undefined;
  countryCallingCode: string;
  nationalNumber: string;
}

/**
 * Validate a phone number against libphonenumber's numbering-plan metadata and
 * return a canonical E.164 value suitable for storage and lookup.
 *
 * `defaultCountry` is used only for national numbers such as `898038051`.
 * When omitted, callers must supply an international number beginning with `+`.
 */
export function normalizePhoneNumber(input: string, defaultCountry?: CountryCode): NormalizedPhoneNumber {
  const value = input.trim();
  if (!value) throw new Error('Phone number is required');

  if (!isValidPhoneNumber(value, defaultCountry)) {
    throw new Error('Enter a valid phone number');
  }

  const parsed = parsePhoneNumberWithError(value, defaultCountry);

  return {
    e164: parsed.number,
    country: parsed.country,
    countryCallingCode: parsed.countryCallingCode,
    nationalNumber: parsed.nationalNumber,
  };
}

export function normalizePhoneNumberOrThrow(
  input: string,
  defaultCountry: CountryCode = 'IN'
): string {
  return normalizePhoneNumber(input, defaultCountry).e164;
}

export function phoneExample(country: CountryCode): string {
  return `+${getCountryCallingCode(country)} …`;
}
