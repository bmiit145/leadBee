import { z } from 'zod';

/**
 * Shared response-envelope schemas.
 *
 * `data` is deliberately left opaque (`z.unknown()`).
 *
 * Fastify's schema serializer **removes any property the response schema does
 * not declare**. On a port where the mobile client expects a field-for-field
 * identical payload, a response schema that is merely incomplete does not fail
 * loudly — it quietly ships a lead object with fields missing, and the bug shows
 * up as a blank row in the app. Declaring the envelope (which is stable) and
 * leaving the payload opaque gets the OpenAPI structure without that risk.
 *
 * Where a payload shape is genuinely fixed and worth pinning — auth, health —
 * the module declares it explicitly.
 */

export const errorEnvelope = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
  requestId: z.string(),
});

export const okEnvelope = z.object({
  success: z.literal(true),
  data: z.unknown(),
});

export const messageEnvelope = z.object({
  success: z.literal(true),
  message: z.string(),
});

export const listEnvelope = z.object({
  success: z.literal(true),
  data: z.array(z.unknown()),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number(),
});

/** The error responses every authenticated route can produce. */
export const commonErrors = {
  400: errorEnvelope,
  401: errorEnvelope,
  403: errorEnvelope,
  404: errorEnvelope,
  422: errorEnvelope,
  429: errorEnvelope,
  500: errorEnvelope,
} as const;

// ─── Reusable primitives ──────────────────────────────────────────────────────

export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const idParam = z.object({ id: objectIdSchema });

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/**
 * Query strings carry `"true"`, not `true`. Coercing with `z.coerce.boolean()`
 * is wrong here — it makes the string `"false"` truthy.
 */
export const booleanQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');
