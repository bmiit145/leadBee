import { z } from 'zod';
import { isExpoPushToken } from '../../lib/expoPush.js';

export const objectId = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const loginBody = z.object({
  /**
   * Email or mobile number — one field, told apart by an `@`. Normalised in the
   * service, which is where the same rule serves every caller.
   */
  identifier: z.string().trim().min(1).max(254).optional(),
  /**
   * Accepted from app builds released before sign-in by email, which send the
   * mobile number under this name. A native build in someone's pocket cannot be
   * updated by redeploying the API, so the old field keeps working.
   */
  phone: z.string().trim().min(1).max(32).optional(),
  password: z.string().min(1, 'Password is required'),
  /**
   * Only needed when the account belongs to more than one organization. The
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
  newPassword: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export const pushTokenBody = z.object({
  // Only Expo tokens are ever sent to. Anything else would be stored, then
  // silently skipped at delivery — and could be used to clear a real token.
  pushToken: z.string().trim().max(200).refine(isExpoPushToken, 'Not an Expo push token'),
});

export const updateMeBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  // `''` is accepted by the schema and refused by the handler with a reason: an
  // account cannot exist without the email its owner signs in with.
  email: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal('')),
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
