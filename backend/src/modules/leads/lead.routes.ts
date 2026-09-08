import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { leadService } from './lead.service.js';
import { leadThreadService } from './leadThread.service.js';
import {
  assignLeadBody,
  createCallLogBody,
  createDocumentBody,
  createLeadBody,
  createThreadItemBody,
  dashboardStatsQuery,
  listDocumentsQuery,
  listLeadsQuery,
  listThreadQuery,
  updateLeadBody,
  updateStageBody,
  updateThreadItemBody,
} from './lead.schema.js';
import {
  commonErrors,
  idParam,
  listEnvelope,
  messageEnvelope,
  objectIdSchema,
  okEnvelope,
  paginationQuery,
} from '../../lib/schemas.js';
import { message, ok, paginated } from '../../lib/response.js';
import { viewerOf } from '../../lib/viewer.js';
import { organizationService } from '../organizations/organization.service.js';
import { PERMISSIONS, type LeadStage } from '../../config/constants.js';
import type { LeadThreadChannel } from '../../models/LeadThreadItem.js';
import type { LeadDocumentKind } from '../../models/LeadDocument.js';

const security = [{ tenantToken: [] }];

export async function leadRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Everything below this line requires a valid tenant token.
  r.addHook('preHandler', app.authenticateTenant);

  // ─── Dashboard ──────────────────────────────────────────────────────────────
  r.route({
    method: 'GET',
    url: '/stats/dashboard',
    schema: {
      tags: ['leads'],
      summary: 'Stage, priority and overdue counts for the dashboard',
      security,
      querystring: dashboardStatsQuery,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const stats = await leadService.dashboardStats(
        viewerOf(request),
        request.query.project
      );
      return ok(stats);
    },
  });

  // ─── Collection ─────────────────────────────────────────────────────────────
  r.route({
    method: 'GET',
    url: '/',
    preHandler: [app.requirePermission(PERMISSIONS.LEADS_VIEW)],
    schema: {
      tags: ['leads'],
      summary: 'List leads',
      description:
        'Organizers see every lead in the organization; everyone else sees only ' +
        'leads assigned to or created by them.',
      security,
      querystring: listLeadsQuery,
      response: { 200: listEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const { data, total, page, limit } = await leadService.list(
        request.query,
        viewerOf(request)
      );
      return paginated(data, total, page, limit);
    },
  });

  r.route({
    method: 'POST',
    url: '/',
    preHandler: [app.requirePermission(PERMISSIONS.LEADS_CREATE)],
    schema: {
      tags: ['leads'],
      summary: 'Create a lead',
      security,
      body: createLeadBody,
      response: { 201: okEnvelope, ...commonErrors, 402: commonErrors[400] },
    },
    handler: async (request, reply) => {
      await organizationService.assertCanAddLead(request.auth!.organization);
      const lead = await leadService.create(request.body, viewerOf(request));
      return reply.status(201).send(ok(lead));
    },
  });

  // ─── Single lead ────────────────────────────────────────────────────────────
  r.route({
    method: 'GET',
    url: '/:id',
    preHandler: [app.requirePermission(PERMISSIONS.LEADS_VIEW)],
    schema: {
      tags: ['leads'],
      summary: 'Get one lead',
      security,
      params: idParam,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const lead = await leadService.getById(request.params.id, viewerOf(request));
      return ok(lead);
    },
  });

  r.route({
    method: 'PUT',
    url: '/:id',
    preHandler: [app.requirePermission(PERMISSIONS.LEADS_EDIT)],
    schema: {
      tags: ['leads'],
      summary: 'Update a lead',
      description: 'Stage is not accepted here — use PUT /leads/:id/stage.',
      security,
      params: idParam,
      body: updateLeadBody,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const lead = await leadService.update(
        request.params.id,
        request.body,
        viewerOf(request)
      );
      return ok(lead);
    },
  });

  r.route({
    method: 'PUT',
    url: '/:id/stage',
    preHandler: [app.requirePermission(PERMISSIONS.LEADS_EDIT)],
    schema: {
      tags: ['leads'],
      summary: 'Move a lead to another stage, optionally setting the next reminder',
      security,
      params: idParam,
      body: updateStageBody,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const { stage, lostReason, nextFollowUpAt, reminderMinutesBefore } = request.body;
      const lead = await leadService.updateStage(
        request.params.id,
        stage as LeadStage,
        viewerOf(request),
        {
          lostReason,
          // null clears the reminder; undefined leaves it untouched.
          nextFollowUpAt:
            nextFollowUpAt === undefined
              ? undefined
              : nextFollowUpAt === null
                ? null
                : new Date(nextFollowUpAt),
          reminderMinutesBefore,
        }
      );
      return ok(lead);
    },
  });

  r.route({
    method: 'PUT',
    url: '/:id/assign',
    preHandler: [app.requireOrganizer],
    schema: {
      tags: ['leads'],
      summary: 'Assign a lead to a user (organizers only)',
      security,
      params: idParam,
      body: assignLeadBody,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const lead = await leadService.assign(
        request.params.id,
        request.body.assignedTo,
        viewerOf(request)
      );
      return ok(lead);
    },
  });

  r.route({
    method: 'PATCH',
    url: '/:id/bookmark',
    schema: {
      tags: ['leads'],
      summary: 'Toggle the bookmark flag',
      security,
      params: idParam,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const lead = await leadService.toggleBookmark(
        request.params.id,
        viewerOf(request)
      );
      return ok(lead);
    },
  });

  r.route({
    method: 'DELETE',
    url: '/:id',
    preHandler: [app.requireOrganizer],
    schema: {
      tags: ['leads'],
      summary: 'Soft-delete a lead (organizers only)',
      security,
      params: idParam,
      response: { 200: messageEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      await leadService.remove(request.params.id);
      return message('Lead deleted');
    },
  });

  // ─── Call logs ──────────────────────────────────────────────────────────────
  r.route({
    method: 'GET',
    url: '/:id/call-logs',
    schema: {
      tags: ['leads'],
      summary: 'Call history for a lead',
      security,
      params: idParam,
      querystring: paginationQuery,
      response: { 200: listEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const { data, total, page, limit } = await leadService.listCallLogs(
        request.params.id,
        viewerOf(request),
        request.query.page,
        request.query.limit
      );
      return paginated(data, total, page, limit);
    },
  });

  r.route({
    method: 'POST',
    url: '/:id/call-logs',
    schema: {
      tags: ['leads'],
      summary: 'Log a call, updating the lead’s last-contacted and follow-up',
      security,
      params: idParam,
      body: createCallLogBody,
      response: { 201: okEnvelope, ...commonErrors },
    },
    handler: async (request, reply) => {
      const { outcome, duration, calledAt, notes, nextFollowUpAt } = request.body;
      const callLog = await leadService.addCallLog(
        request.params.id,
        {
          outcome,
          duration,
          calledAt: calledAt ? new Date(calledAt) : undefined,
          notes,
          nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt) : undefined,
        },
        viewerOf(request)
      );
      return reply.status(201).send(ok(callLog));
    },
  });

  // ─── Threads: Time Line / Notes / Ask Query ─────────────────────────────────
  r.route({
    method: 'GET',
    url: '/:id/thread',
    schema: {
      tags: ['leads'],
      summary: 'Read one thread channel on a lead',
      security,
      params: idParam,
      querystring: listThreadQuery,
      response: { 200: listEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const { channel, page, limit, resolved } = request.query;
      const result = await leadThreadService.list(
        request.params.id,
        channel as LeadThreadChannel,
        viewerOf(request),
        { page, limit, resolved }
      );
      return paginated(result.data, result.total, result.page, result.limit);
    },
  });

  r.route({
    method: 'POST',
    url: '/:id/thread',
    schema: {
      tags: ['leads'],
      summary: 'Post to a thread channel',
      security,
      params: idParam,
      body: createThreadItemBody,
      response: { 201: okEnvelope, ...commonErrors },
    },
    handler: async (request, reply) => {
      const item = await leadThreadService.create(
        request.params.id,
        request.body.channel as LeadThreadChannel,
        request.body.text,
        viewerOf(request)
      );
      return reply.status(201).send(ok(item));
    },
  });

  r.route({
    method: 'PUT',
    url: '/:id/thread/:itemId',
    schema: {
      tags: ['leads'],
      summary: 'Edit a thread entry (author or organizer)',
      security,
      params: z.object({ id: objectIdSchema, itemId: objectIdSchema }),
      body: updateThreadItemBody,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const item = await leadThreadService.update(
        request.params.id,
        request.params.itemId,
        request.body.text,
        viewerOf(request)
      );
      return ok(item);
    },
  });

  r.route({
    method: 'PATCH',
    url: '/:id/thread/:itemId/resolve',
    schema: {
      tags: ['leads'],
      summary: 'Toggle resolved on an Ask Query entry',
      security,
      params: z.object({ id: objectIdSchema, itemId: objectIdSchema }),
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const item = await leadThreadService.toggleResolved(
        request.params.id,
        request.params.itemId,
        viewerOf(request)
      );
      return ok(item);
    },
  });

  r.route({
    method: 'DELETE',
    url: '/:id/thread/:itemId',
    schema: {
      tags: ['leads'],
      summary: 'Delete a thread entry (author or organizer)',
      security,
      params: z.object({ id: objectIdSchema, itemId: objectIdSchema }),
      response: { 200: messageEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      await leadThreadService.remove(
        request.params.id,
        request.params.itemId,
        viewerOf(request)
      );
      return message('Entry deleted');
    },
  });

  // ─── Documents / Attachments ────────────────────────────────────────────────
  r.route({
    method: 'GET',
    url: '/:id/documents',
    schema: {
      tags: ['leads'],
      summary: 'List a lead’s documents or attachments',
      security,
      params: idParam,
      querystring: listDocumentsQuery,
      response: { 200: listEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const { kind, page, limit } = request.query;
      const result = await leadThreadService.listDocuments(
        request.params.id,
        viewerOf(request),
        { kind: kind as LeadDocumentKind | undefined, page, limit }
      );
      return paginated(result.data, result.total, result.page, result.limit);
    },
  });

  r.route({
    method: 'POST',
    url: '/:id/documents',
    schema: {
      tags: ['leads'],
      summary: 'Link a document or attachment to a lead',
      security,
      params: idParam,
      body: createDocumentBody,
      response: { 201: okEnvelope, ...commonErrors },
    },
    handler: async (request, reply) => {
      const doc = await leadThreadService.addDocument(
        request.params.id,
        request.body as Parameters<typeof leadThreadService.addDocument>[1],
        viewerOf(request)
      );
      return reply.status(201).send(ok(doc));
    },
  });

  r.route({
    method: 'DELETE',
    url: '/:id/documents/:docId',
    schema: {
      tags: ['leads'],
      summary: 'Unlink a document (uploader or organizer)',
      security,
      params: z.object({ id: objectIdSchema, docId: objectIdSchema }),
      response: { 200: messageEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      await leadThreadService.removeDocument(
        request.params.id,
        request.params.docId,
        viewerOf(request)
      );
      return message('Document removed');
    },
  });
}
