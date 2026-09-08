import { z } from 'zod';

export const loginSchema = z.object({
  phone: z
    .string()
    .min(10, 'Phone number must be at least 10 digits')
    .max(15, 'Phone number too long')
    .regex(/^\d+$/, 'Phone number must contain only digits'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export type LoginFormData = z.infer<typeof loginSchema>;

/** Self-serve signup, for the "create an organization" flow. */
export const signupSchema = z.object({
  organizationName: z.string().trim().min(2, 'Organization name is required'),
  ownerName: z.string().trim().min(2, 'Your name is required'),
  ownerPhone: z
    .string()
    .min(10, 'Phone number must be at least 10 digits')
    .max(15, 'Phone number too long')
    .regex(/^\d+$/, 'Phone number must contain only digits'),
  ownerEmail: z.string().email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type SignupFormData = z.infer<typeof signupSchema>;
