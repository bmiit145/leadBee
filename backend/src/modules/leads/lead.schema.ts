import { z } from 'zod';
import {
  CALL_OUTCOME_ORDER,
  LEAD_PRIORITY_ORDER,
  LEAD_SOURCE_ORDER,
  LEAD_STAGE_ORDER,
} from '../../config/constants.js';
import { LEAD_THREAD_CHANNELS } from '../../models/LeadThreadItem.js';
import { booleanQuery, objectIdSchema, paginationQuery } from '../../lib/schemas.js';
import { contactPhoneSchema } from '../../lib/phone.js';

const optionalText = z.string().trim().optional();

export const createLeadBody = z.object({
  contactName: z.string().trim().min(1, 'Contact name is required'),
  contactPhone: contactPhoneSchema,
  // Optional, but an empty string is how the mobile form sends "not provided".
  contactSecondPhone: contactPhoneSchema.optional().or(z.literal('')),
  contactEmail: z.string().email('Invalid email').optional().or(z.literal('')),
  source: z.enum(LEAD_SOURCE_ORDER as [string, ...string[]]).optional(),
  sourceDetail: optionalText,
  priority: z.enum(LEAD_PRIORITY_ORDER as [string, ...string[]]).optional(),
  stage: z.enum(LEAD_STAGE_ORDER as [string, ...string[]]).optional(),
  project: objectIdSchema.optional(),
  interestedIn: optionalText,
  budgetMin: z.coerce.number().nonnegative().optional(),
  budgetMax: z.coerce.number().nonnegative().optional(),
  preferredConfig: optionalText,
  address: optionalText,
  gstNumber: optionalText,
  assignedTo: objectIdSchema.optional(),
  nextFollowUpAt: z.string().datetime({ offset: true }).optional(),
  reminderMinutesBefore: z.array(z.number().int().min(0)).optional(),
  notes: optionalText,
});

export const updateLeadBody = createLeadBody
  .partial()
  // Stage moves through its own endpoint so the transition guard cannot be
  // bypassed by sending `stage` to the generic update.
  .omit({ stage: true })
  .extend({ lostReason: optionalText });

export const updateStageBody = z.object({
  stage: z.enum(LEAD_STAGE_ORDER as [string, ...string[]]),
  lostReason: optionalText,
  // Set together with the stage change, matching the combined dialog in the UI.
  nextFollowUpAt: z.string().datetime({ offset: true }).nullable().optional(),
  reminderMinutesBefore: z.array(z.number().int().min(0)).optional(),
});

export const assignLeadBody = z.object({
  assignedTo: objectIdSchema,
});

export const listLeadsQuery = paginationQuery.extend({
  stage: z.enum(LEAD_STAGE_ORDER as [string, ...string[]]).optional(),
  priority: z.enum(LEAD_PRIORITY_ORDER as [string, ...string[]]).optional(),
  source: z.enum(LEAD_SOURCE_ORDER as [string, ...string[]]).optional(),
  assignedTo: objectIdSchema.optional(),
  project: objectIdSchema.optional(),
  search: z.string().trim().optional(),
  overdueFollowUp: booleanQuery.optional(),
  /** Powers the Reminder screen's Today / Tomorrow / Overdue tabs. */
  reminderScope: z.enum(['today', 'tomorrow', 'overdue']).optional(),
  /** Powers the dedicated Bookmarks screen. */
  bookmarked: booleanQuery.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  budgetMin: z.coerce.number().optional(),
  budgetMax: z.coerce.number().optional(),
});

export const createCallLogBody = z.object({
  outcome: z.enum(CALL_OUTCOME_ORDER as [string, ...string[]]),
  duration: z.coerce.number().int().min(0).optional(),
  calledAt: z.string().datetime({ offset: true }).optional(),
  notes: optionalText,
  nextFollowUpAt: z.string().datetime({ offset: true }).optional(),
});

// ─── Threads ──────────────────────────────────────────────────────────────────

export const listThreadQuery = paginationQuery.extend({
  channel: z.enum(LEAD_THREAD_CHANNELS as [string, ...string[]]),
  resolved: booleanQuery.optional(),
});

export const createThreadItemBody = z.object({
  channel: z.enum(LEAD_THREAD_CHANNELS as [string, ...string[]]),
  text: z.string().trim().min(1, 'Message cannot be empty').max(5000),
});

export const updateThreadItemBody = z.object({
  text: z.string().trim().min(1).max(5000),
});

// ─── Documents ────────────────────────────────────────────────────────────────

export const listDocumentsQuery = paginationQuery.extend({
  kind: z.enum(['document', 'attachment']).optional(),
});

export const createDocumentBody = z.object({
  kind: z.enum(['document', 'attachment']),
  name: z.string().trim().min(1),
  url: z.string().trim().url('A valid URL is required'),
  mimeType: optionalText,
  size: z.coerce.number().int().min(0).optional(),
});

export const dashboardStatsQuery = z.object({
  project: objectIdSchema.optional(),
});
