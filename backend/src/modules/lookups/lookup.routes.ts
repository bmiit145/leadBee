import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { Project } from '../../models/Project.js';
import { PurposeOfInquiry } from '../../models/PurposeOfInquiry.js';
import { QuickReply } from '../../models/QuickReply.js';
import { AppError } from '../../lib/errors.js';
import { commonErrors, idParam, messageEnvelope, okEnvelope } from '../../lib/schemas.js';
import { message, ok } from '../../lib/response.js';
import {
  LEAD_PRIORITY_ORDER,
  LEAD_SOURCE_ORDER,
  LEAD_STAGE_ORDER,
  CALL_OUTCOME_ORDER,
  VALID_LEAD_STAGE_TRANSITIONS,
} from '../../config/constants.js';
import { MEETING_TYPE_ORDER, MEETING_STATUS_ORDER } from '../../models/Meeting.js';
import { TASK_STATUS_ORDER } from '../../models/Task.js';
import { requireUserId } from '../../lib/tenantContext.js';

const security = [{ tenantToken: [] }];

/**
 * Small tenant-owned reference lists — projects, meeting purposes, quick
 * replies — plus the static enum vocabulary.
 *
 * Grouped into one module because each is a handful of routes over a two-field
 * document; separate modules would be more ceremony than code.
 */
export async function lookupRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('preHandler', app.authenticateTenant);

  // ─── Static vocabulary ──────────────────────────────────────────────────────
  r.route({
    method: 'GET',
    url: '/meta/enums',
    schema: {
      tags: ['lookups'],
      summary: 'Every enum the clients render as chips, tabs or dropdowns',
      description:
        'Served rather than hardcoded in the apps so adding a lead stage does ' +
        'not require shipping a new mobile build.',
      security,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async () =>
      ok({
        leadStages: LEAD_STAGE_ORDER,
        leadStageTransitions: VALID_LEAD_STAGE_TRANSITIONS,
        leadSources: LEAD_SOURCE_ORDER,
        leadPriorities: LEAD_PRIORITY_ORDER,
        callOutcomes: CALL_OUTCOME_ORDER,
        meetingTypes: MEETING_TYPE_ORDER,
        meetingStatuses: MEETING_STATUS_ORDER,
        taskStatuses: TASK_STATUS_ORDER,
      }),
  });

  // ─── Projects ───────────────────────────────────────────────────────────────
  r.route({
    method: 'GET',
    url: '/projects',
    schema: {
      tags: ['lookups'],
      summary: 'List lead groupings',
      security,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async () =>
      ok(await Project.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean()),
  });

  r.route({
    method: 'POST',
    url: '/projects',
    schema: {
      tags: ['lookups'],
      summary: 'Create a lead grouping',
      security,
      body: z.object({
        name: z.string().trim().min(1).max(80),
        description: z.string().trim().optional(),
        color: z.string().trim().optional(),
      }),
      response: { 201: okEnvelope, ...commonErrors },
    },
    handler: async (request, reply) => {
      const project = await Project.create({
        ...request.body,
        createdBy: requireUserId(),
      });
      return reply.status(201).send(ok(project));
    },
  });

  r.route({
    method: 'PUT',
    url: '/projects/:id',
    schema: {
      tags: ['lookups'],
      summary: 'Update a lead grouping',
      security,
      params: idParam,
      body: z.object({
        name: z.string().trim().min(1).max(80).optional(),
        description: z.string().trim().optional(),
        color: z.string().trim().optional(),
        isActive: z.boolean().optional(),
        sortOrder: z.number().int().optional(),
      }),
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const project = await Project.findByIdAndUpdate(request.params.id, request.body, {
        new: true,
        runValidators: true,
      });
      if (!project) throw AppError.notFound('Project not found');
      return ok(project);
    },
  });

  // ─── Meeting purposes ───────────────────────────────────────────────────────
  r.route({
    method: 'GET',
    url: '/purposes',
    schema: {
      tags: ['lookups'],
      summary: 'List meeting purposes',
      security,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async () =>
      ok(
        await PurposeOfInquiry.find({ isActive: true })
          .sort({ sortOrder: 1, name: 1 })
          .lean()
      ),
  });

  r.route({
    method: 'POST',
    url: '/purposes',
    schema: {
      tags: ['lookups'],
      summary: 'Add a meeting purpose',
      security,
      body: z.object({ name: z.string().trim().min(1).max(80) }),
      response: { 201: okEnvelope, ...commonErrors },
    },
    handler: async (request, reply) => {
      const purpose = await PurposeOfInquiry.create({
        name: request.body.name,
        createdBy: requireUserId(),
      });
      return reply.status(201).send(ok(purpose));
    },
  });

  r.route({
    method: 'DELETE',
    url: '/purposes/:id',
    schema: {
      tags: ['lookups'],
      summary: 'Retire a meeting purpose',
      description:
        'Deactivates rather than deletes — past meetings reference it, and a ' +
        'dangling reference would render as a blank purpose.',
      security,
      params: idParam,
      response: { 200: messageEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const purpose = await PurposeOfInquiry.findByIdAndUpdate(request.params.id, {
        isActive: false,
      });
      if (!purpose) throw AppError.notFound('Purpose not found');
      return message('Purpose retired');
    },
  });

  // ─── Quick replies ──────────────────────────────────────────────────────────
  // Personal to their author: the panel shows a per-user count, and one agent's
  // canned messages are not another's business.
  r.route({
    method: 'GET',
    url: '/quick-replies',
    schema: {
      tags: ['lookups'],
      summary: 'List your own quick replies',
      security,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async () =>
      ok(
        await QuickReply.find({ createdByUser: requireUserId() })
          .sort({ createdAt: -1 })
          .lean()
      ),
  });

  r.route({
    method: 'POST',
    url: '/quick-replies',
    schema: {
      tags: ['lookups'],
      summary: 'Save a quick reply',
      security,
      body: z.object({
        shortcut: z.string().trim().min(1).max(40),
        message: z.string().trim().min(1).max(2000),
      }),
      response: { 201: okEnvelope, ...commonErrors },
    },
    handler: async (request, reply) => {
      const reply_ = await QuickReply.create({
        ...request.body,
        createdByUser: requireUserId(),
      });
      return reply.status(201).send(ok(reply_));
    },
  });

  r.route({
    method: 'PUT',
    url: '/quick-replies/:id',
    schema: {
      tags: ['lookups'],
      summary: 'Edit one of your quick replies',
      security,
      params: idParam,
      body: z.object({
        shortcut: z.string().trim().min(1).max(40).optional(),
        message: z.string().trim().min(1).max(2000).optional(),
      }),
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      // Scoped by author as well as tenant — an id alone must not let one agent
      // edit another's saved replies.
      const item = await QuickReply.findOneAndUpdate(
        { _id: request.params.id, createdByUser: requireUserId() },
        request.body,
        { new: true, runValidators: true }
      );
      if (!item) throw AppError.notFound('Quick reply not found');
      return ok(item);
    },
  });

  r.route({
    method: 'DELETE',
    url: '/quick-replies/:id',
    schema: {
      tags: ['lookups'],
      summary: 'Delete one of your quick replies',
      security,
      params: idParam,
      response: { 200: messageEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const item = await QuickReply.findOneAndDelete({
        _id: request.params.id,
        createdByUser: requireUserId(),
      });
      if (!item) throw AppError.notFound('Quick reply not found');
      return message('Quick reply deleted');
    },
  });
}
