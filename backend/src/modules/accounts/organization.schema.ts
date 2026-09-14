import { z } from 'zod';

/**
 * What a person supplies to create an organization they will own. The owner is
 * the signed-in account, so nothing about them is asked for. Shared by the
 * account-session route (first organization) and the membership route (another
 * one), so the two cannot accept different shapes.
 */
export const createOrganizationBody = z.object({
  organizationName: z.string().trim().min(2, 'Organization name is required').max(120),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens only')
    .optional(),
});
