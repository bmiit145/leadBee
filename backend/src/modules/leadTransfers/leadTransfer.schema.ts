import { z } from 'zod';
import { objectIdSchema, paginationQuery } from '../../lib/schemas.js';
import { LEAD_TRANSFER_STATUS_ORDER } from '../../models/LeadTransfer.js';

export const TRANSFER_BOXES = ['received', 'sent', 'all'] as const;

export const listTransfersQuery = paginationQuery.extend({
  box: z.enum(TRANSFER_BOXES).default('received'),
  status: z.enum(LEAD_TRANSFER_STATUS_ORDER).optional(),
});

export const createTransferBody = z.object({
  leadId: objectIdSchema,
  toUserId: objectIdSchema,
  /**
   * Optional, as in other CRMs' ownership transfer: forcing a reason on every
   * routine hand-off produces "ok" and "." rather than information. Recorded
   * when given; blank is the same as absent.
   */
  reason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => value || undefined),
});

export const decideTransferBody = z.object({
  note: z.string().trim().max(500).optional(),
});

export const recipientsQuery = paginationQuery.extend({
  search: z.string().trim().max(80).optional(),
});

export const leadIdParam = z.object({ leadId: objectIdSchema });
