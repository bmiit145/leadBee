import { z } from 'zod';
import { parsePhoneNumberFromString, type CountryCode, type NumberType } from 'libphonenumber-js/max';

/**
 * Region a number typed without a country code belongs to. Mirrors the server's
 * `DEFAULT_PHONE_REGION`; if that changes, change this too.
 */
const DEFAULT_REGION: CountryCode = 'IN';

const MOBILE_TYPES: ReadonlySet<NumberType> = new Set<NumberType>(['MOBILE', 'FIXED_LINE_OR_MOBILE']);

/**
 * Matches `backend/src/lib/phone.ts`.
 *
 * The previous rule here was "10-15 digits, digits only", which disagreed with
 * the server in both directions: it refused `+91 90000 00001`, which the API
 * accepts, and allowed a landline, which the API does not.
 */
export function isValidMobilePhone(raw: string): boolean {
  const parsed = parsePhoneNumberFromString(raw.trim(), DEFAULT_REGION);
  if (!parsed?.isValid()) return false;

  const type = parsed.getType();
  return type === undefined || MOBILE_TYPES.has(type);
}

/**
 * A real, dialable number of any kind. Used for a lead's contact number, where
 * a landline or a foreign number is legitimate and only nonsense is rejected.
 */
export function isValidPhone(raw: string): boolean {
  return parsePhoneNumberFromString(raw.trim(), DEFAULT_REGION)?.isValid() ?? false;
}

/**
 * Canonical form the API stores, so a number typed with spaces or a country
 * code still reaches the right account. Total: an unparseable value comes back
 * trimmed, matching the server's lenient login lookup.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const parsed = parsePhoneNumberFromString(trimmed, DEFAULT_REGION);
  if (!parsed?.isValid()) return trimmed;

  return parsed.country === DEFAULT_REGION ? parsed.nationalNumber : parsed.number;
}

/**
 * Sign-in is deliberately lenient about *shape*: an account created before the
 * number rules tightened must still be able to log in. It is normalised so the
 * lookup matches however the number was typed, and the password is what decides.
 */
const loginPhone = z
  .string()
  .trim()
  .min(1, 'Phone number is required')
  .transform(normalizePhone);

/** Creating an account holds the number to the same rule the API enforces. */
const newAccountPhone = z
  .string()
  .trim()
  .min(1, 'Phone number is required')
  .refine(isValidMobilePhone, 'Enter a valid mobile number')
  .transform(normalizePhone);

export const loginSchema = z.object({
  phone: loginPhone,
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export type LoginFormData = z.infer<typeof loginSchema>;

/** Self-serve signup, for the "create an organization" flow. */
export const signupSchema = z.object({
  organizationName: z.string().trim().min(2, 'Organization name is required'),
  ownerName: z.string().trim().min(2, 'Your name is required'),
  ownerPhone: newAccountPhone,
  ownerEmail: z.string().email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type SignupFormData = z.infer<typeof signupSchema>;
