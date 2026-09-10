import { z } from 'zod';
import { loginPhoneSchema } from '../../lib/phone.js';

export const objectId = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const loginBody = z.object({
  phone: loginPhoneSchema,
  password: z.string().min(1, 'Password is required'),
  /**
   * Only needed when the same phone belongs to more than one organization. The
   * login screen omits it; the API asks for it with a 409 and the client
   * re-submits with the chosen org.
   */
  organizationId: objectId.optional(),
});

export const refreshBody = z.object({
  refreshToken: z.string().min(1),
});

export const changePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6, 'Password must be at least 6 characters'),
});

export const pushTokenBody = z.object({
  pushToken: z.string().trim().min(1),
});

export const updateMeBody = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().email().optional().or(z.literal('')),
  avatarUrl: z.string().trim().optional(),
  designation: z.string().trim().optional(),
  locale: z.string().trim().min(2).max(8).optional(),
});

// ─── Response shapes ──────────────────────────────────────────────────────────

export const userView = z.object({
  _id: z.string(),
  name: z.string(),
  phone: z.string(),
  email: z.string().optional(),
  role: z.string(),
  permissions: z.array(z.string()),
  avatarUrl: z.string().optional(),
  designation: z.string().optional(),
  locale: z.string(),
  isActive: z.boolean(),
});

export const organizationView = z.object({
  _id: z.string(),
  name: z.string(),
  slug: z.string(),
  plan: z.string(),
  status: z.string(),
  features: z.array(z.string()),
  trialEndsAt: z.string().optional(),
});

export const authPayload = z.object({
  success: z.literal(true),
  data: z.object({
    user: userView,
    organization: organizationView,
    accessToken: z.string(),
    refreshToken: z.string(),
  }),
});
