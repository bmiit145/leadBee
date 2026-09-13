import { z } from 'zod';
import { mobilePhoneSchema } from '../../lib/phone.js';

/**
 * Lower-cased at the edge so `Asha@Example.com` and `asha@example.com` are one
 * account, not two that both verify.
 */
const emailSchema = z.string().trim().toLowerCase().email('A valid email is required').max(254);

/** Opaque, issued by /register. Bounded so a junk value is refused cheaply. */
const registrationTokenSchema = z.string().trim().min(20).max(200);

export const registerBody = z.object({
  firstName: z.string().trim().min(2, 'First name is required').max(40),
  lastName: z.string().trim().min(1, 'Last name is required').max(40),
  email: emailSchema,
  phone: mobilePhoneSchema,
  // An upper bound too: bcrypt reads only the first 72 bytes, and an unbounded
  // field is a free way to make the server hash megabytes.
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  acceptedTerms: z
    .boolean()
    .refine((value) => value === true, 'You must accept the terms to register'),
});

export const verifyEmailBody = z.object({
  email: emailSchema,
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  registrationToken: registrationTokenSchema,
});

export const resendVerificationBody = z.object({
  email: emailSchema,
  registrationToken: registrationTokenSchema,
});
