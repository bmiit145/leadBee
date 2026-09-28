import { z } from 'zod';
import { objectIdSchema, paginationQuery } from '../../lib/schemas.js';
import { INVITE_STATUS_ORDER } from '../../models/OrganizationInvite.js';
import { JOIN_REQUEST_STATUS_ORDER } from '../../models/JoinRequest.js';
import { ROLES } from '../../config/constants.js';

/** Only roles a link may hand out; organizer roles are refused by the policy too. */
const linkRole = z.enum([ROLES.USER, ROLES.PARTNER]);

/** `null` clears the expiry (a link that never lapses); absent leaves it alone. */
const expiresInDays = z.number().int().min(1).max(365).nullable();
const maxUses = z.number().int().min(1).max(500).nullable();

export const issueLinkBody = z.object({
  role: linkRole.optional(),
  requiresApproval: z.boolean().optional(),
  expiresInDays: expiresInDays.optional(),
  maxUses: maxUses.optional(),
});

export const updateLinkBody = issueLinkBody;

export const createInviteBody = z.object({
  email: z.string().trim().toLowerCase().email('A valid email is required').max(254),
  /** Optional, so the admin can send the link by SMS or WhatsApp as well. */
  phone: z.string().trim().max(20).optional(),
  role: linkRole.optional(),
  message: z.string().trim().max(300).optional(),
});

export const listInvitesQuery = paginationQuery.extend({
  status: z.enum(INVITE_STATUS_ORDER).optional(),
});

export const listRequestsQuery = paginationQuery.extend({
  status: z.enum(JOIN_REQUEST_STATUS_ORDER).optional(),
});

export const decideRequestBody = z.object({
  /** An admin may let someone in as something other than the link's role. */
  role: linkRole.optional(),
});

// ─── The joining side ───────────────────────────────────────────────────────

export const joinCodeBody = z.object({
  /** A code or a pasted invite link; both are reduced to the code. */
  code: z.string().trim().min(4).max(200),
  message: z.string().trim().max(300).optional(),
});

export const previewQuery = z.object({
  code: z.string().trim().min(4).max(200),
});

export const acceptInviteBody = z.object({
  token: z.string().trim().min(10).max(200),
});

export const requestIdParam = z.object({ requestId: objectIdSchema });
