/**
 * Phone validation for the control plane, mirroring `backend/src/lib/phone.ts`.
 *
 * The server is the authority — this exists so a superadmin finds out about a
 * bad number while the field is in front of them, rather than through a toast
 * after submit. Both sides use `libphonenumber-js`, so they agree on what is
 * valid without either restating the rules.
 */

import { parsePhoneNumberFromString, type CountryCode, type NumberType } from 'libphonenumber-js/max';

/**
 * Region a number typed without a country code belongs to.
 *
 * The server reads this from `DEFAULT_PHONE_REGION`; the dashboard has no
 * runtime config of its own, so it is pinned here. If the server's value ever
 * changes, change it here too — a mismatch shows up as the form accepting a
 * number the API then rejects.
 */
const DEFAULT_REGION: CountryCode = 'IN';

const MOBILE_TYPES: ReadonlySet<NumberType> = new Set<NumberType>(['MOBILE', 'FIXED_LINE_OR_MOBILE']);

/** A real number that can receive a call or SMS on a handset. */
export function isValidMobilePhone(raw: string): boolean {
  const parsed = parsePhoneNumberFromString(raw.trim(), DEFAULT_REGION);
  if (!parsed?.isValid()) return false;

  const type = parsed.getType();
  return type === undefined || MOBILE_TYPES.has(type);
}

/**
 * Validation message for a mobile phone field, or `undefined` when it passes.
 *
 * The caller decides *when* to show this — typically on blur or submit — but an
 * empty value still returns a message rather than nothing, so a blocked submit
 * always has something to point at instead of failing silently.
 */
export function mobilePhoneError(raw: string): string | undefined {
  if (!raw.trim()) return 'Phone number is required';
  return isValidMobilePhone(raw) ? undefined : 'Enter a valid mobile number';
}
