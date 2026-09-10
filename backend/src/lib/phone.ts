/**
 * Phone number validation and normalisation.
 *
 * One module so the three write paths that accept a phone number — superadmin
 * provisioning, self-serve signup, tenant user creation — cannot drift apart.
 * They previously each carried their own `min(6).max(20)` rule, which accepted
 * a 9-digit number the mobile app then refused to log in with.
 *
 * Validation is delegated to `libphonenumber-js` rather than a regex. Per-country
 * mobile prefixes and lengths are data that changes without asking us, and a
 * hand-written pattern encodes today's version of it as if it were permanent.
 */

import { parsePhoneNumberFromString, type CountryCode, type NumberType } from 'libphonenumber-js/max';
import { z } from 'zod';
import { env } from '../config/env.js';

const DEFAULT_REGION: CountryCode = env.DEFAULT_PHONE_REGION;

/**
 * Types we accept where a *mobile* number is required.
 *
 * `FIXED_LINE_OR_MOBILE` is what several countries report when the range is
 * shared and the number genuinely cannot be told apart. `undefined` means the
 * metadata has no type information for that range — valid but unclassifiable.
 * Rejecting either would refuse real numbers to prove a point.
 */
const MOBILE_TYPES: ReadonlySet<NumberType> = new Set<NumberType>(['MOBILE', 'FIXED_LINE_OR_MOBILE']);

/**
 * Canonical storage form.
 *
 * A number in the home region is stored as its national digits, which is what
 * every existing row already holds and what the login screen asks a user to
 * type — so `+91 90000 00001`, `90000-00001` and `9000000001` all collapse onto
 * the one stored value and no migration is needed. Anything foreign keeps E.164,
 * where the country code is not optional information.
 *
 * Total by design: an unparseable value comes back trimmed rather than throwing,
 * so it can still be used as a lookup key for rows written before this existed.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const parsed = parsePhoneNumberFromString(trimmed, DEFAULT_REGION);
  if (!parsed?.isValid()) return trimmed;

  return parsed.country === DEFAULT_REGION ? parsed.nationalNumber : parsed.number;
}

/** A real, dialable number of any kind — mobile, landline, VoIP. */
export function isValidPhone(raw: string): boolean {
  return parsePhoneNumberFromString(raw.trim(), DEFAULT_REGION)?.isValid() ?? false;
}

/** A real number that can receive a call or SMS on a handset. */
export function isValidMobilePhone(raw: string): boolean {
  const parsed = parsePhoneNumberFromString(raw.trim(), DEFAULT_REGION);
  if (!parsed?.isValid()) return false;

  const type = parsed.getType();
  return type === undefined || MOBILE_TYPES.has(type);
}

/**
 * For sign-in credentials: the number must be reachable on a handset, because
 * it is how the account is identified and how a reset would be delivered.
 * Output is normalised, so the value written on create matches the value looked
 * up on login regardless of how either was typed.
 */
export const mobilePhoneSchema = z
  .string()
  .trim()
  .min(1, 'Phone number is required')
  .refine(isValidMobilePhone, 'Enter a valid mobile number')
  .transform(normalizePhone);

/**
 * For a contact on a lead, which is reference data rather than a credential.
 * Leads arrive from portals, imports and hand entry, and a landline or a foreign
 * number is legitimate — so this rejects only what is not a phone number at all.
 */
export const contactPhoneSchema = z
  .string()
  .trim()
  .min(1, 'Contact phone is required')
  .refine(isValidPhone, 'Enter a valid phone number')
  .transform(normalizePhone);

/**
 * For the login form only.
 *
 * Deliberately *not* validated: accounts created before this module existed may
 * hold a number that no longer passes, and refusing to look them up would lock
 * those users out rather than merely stopping new bad data. Normalisation still
 * applies, so a user who types `+91 90000 00001` reaches the row stored as
 * `9000000001`. An unknown number fails at the credential check, as it should.
 */
export const loginPhoneSchema = z
  .string()
  .trim()
  .min(1, 'Phone is required')
  .transform(normalizePhone);
