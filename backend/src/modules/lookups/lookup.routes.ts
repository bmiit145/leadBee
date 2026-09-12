import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { Project } from '../../models/Project.js';
import { PurposeOfInquiry } from '../../models/PurposeOfInquiry.js';
import { QuickReply } from '../../models/QuickReply.js';
import { LeadDropReason } from '../../models/LeadDropReason.js';
import { AppError } from '../../lib/errors.js';
import { pageParams } from '../../lib/pagination.js';
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
 * Reference lists feed pickers that render every option, so they are capped
 * rather than paged — a list long enough to page is not a usable picker. The
 * cap exists so an unbounded read can never be the thing that falls over
 * (ENG-15); it is far above what any business curates.
 */
const LOOKUP_CAP = 200;

const dropReasonBody = z.object({ name: z.string().trim().min(1).max(80) });
const purposeBody = z.object({ name: z.string().trim().min(1).max(80) });

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
      ok(
        await Project.find({ isActive: true })
          .sort({ sortOrder: 1, name: 1 })
          .limit(LOOKUP_CAP)
          .lean()
      ),
  });

  r.route({
    method: 'POST',
    url: '/projects',
    preHandler: [app.requireOrganizer],
    schema: {
      tags: ['lookups'],
      summary: 'Create a lead grouping (organizers only)',
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
    preHandler: [app.requireOrganizer],
    schema: {
      tags: ['lookups'],
      summary: 'Update a lead grouping (organizers only)',
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
          .limit(LOOKUP_CAP)
          .lean()
      ),
  });

  r.route({
    method: 'POST',
    url: '/purposes',
    preHandler: [app.requireOrganizer],
    schema: {
      tags: ['lookups'],
      summary: 'Add a meeting purpose (organizers only)',
      security,
      body: purposeBody,
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

  // Declared before `/purposes/:id` for readers; the router would prefer the
  // static segment either way.
  r.route({
    method: 'PUT',
    url: '/purposes/reorder',
    preHandler: [app.requireOrganizer],
    schema: {
      tags: ['lookups'],
      summary: 'Reorder meeting purposes (organizers only)',
      description:
        'Takes the ids in the order they should appear. Ids that are not this ' +
        "tenant's are ignored rather than rejected: the list the app dragged " +
        'may be a moment stale, and a reorder is not worth failing over.',
      security,
      body: z.object({ orderedIds: z.array(objectIdSchema).min(1).max(LOOKUP_CAP) }),
      response: { 200: messageEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const ids = request.body.orderedIds.map((id) => new Types.ObjectId(id));
      // One `updateMany` rather than a write per row: it goes through the
      // tenant plugin (which does not hook `bulkWrite`), and the whole list
      // moves at once instead of leaving a half-applied order behind. The
      // pipeline reads each row's new position out of the id list itself.
      await PurposeOfInquiry.updateMany({ _id: { $in: ids } }, [
        { $set: { sortOrder: { $indexOfArray: [ids, '$_id'] } } },
      ]);
      return message('Purposes reordered');
    },
  });

  r.route({
    method: 'PUT',
    url: '/purposes/:id',
    preHandler: [app.requireOrganizer],
    schema: {
      tags: ['lookups'],
      summary: 'Rename a meeting purpose (organizers only)',
      description: 'Meetings reference the purpose by id, so they follow the new name.',
      security,
      params: idParam,
      body: purposeBody,
      response: { 200: okEnvelope, ...commonErrors, 409: commonErrors[400] },
    },
    handler: async (request) => {
      const purpose = await PurposeOfInquiry.findByIdAndUpdate(
        request.params.id,
        { name: request.body.name },
        { new: true, runValidators: true }
      );
      if (!purpose) throw AppError.notFound('Purpose not found');
      return ok(purpose);
    },
  });

  r.route({
    method: 'DELETE',
    url: '/purposes/:id',
    preHandler: [app.requireOrganizer],
    schema: {
      tags: ['lookups'],
      summary: 'Retire a meeting purpose (organizers only)',
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

  // ─── Lead drop reasons ──────────────────────────────────────────────────────
  // Read by anyone who can close a lead; curated by organizers only.
  r.route({
    method: 'GET',
    url: '/drop-reasons',
    schema: {
      tags: ['lookups'],
      summary: 'List the tags offered when a lead is dropped',
      description:
        'Capped rather than paged: it feeds a picker that shows every option, ' +
        'and a tag list long enough to page is not a usable picker.',
      security,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async () => {
      const reasons = await LeadDropReason.find()
        .sort({ sortOrder: 1, name: 1 })
        .limit(LOOKUP_CAP);
      return ok(reasons.map((reason) => reason.toJSON()));
    },
  });

  r.route({
    method: 'POST',
    url: '/drop-reasons',
    preHandler: [app.requireOrganizer],
    schema: {
      tags: ['lookups'],
      summary: 'Add a drop tag (organizers only)',
      description: 'A name already in use answers 409.',
      security,
      body: dropReasonBody,
      response: { 201: okEnvelope, ...commonErrors, 409: commonErrors[400] },
    },
    handler: async (request, reply) => {
      const reason = await LeadDropReason.create({
        name: request.body.name,
        createdBy: requireUserId(),
      });
      return reply.status(201).send(ok(reason.toJSON()));
    },
  });

  r.route({
    method: 'PUT',
    url: '/drop-reasons/:id',
    preHandler: [app.requireOrganizer],
    schema: {
      tags: ['lookups'],
      summary: 'Rename a drop tag (organizers only)',
      description: 'Leads already dropped with the old name keep it — `lostReason` is text.',
      security,
      params: idParam,
      body: dropReasonBody,
      response: { 200: okEnvelope, ...commonErrors, 409: commonErrors[400] },
    },
    handler: async (request) => {
      const reason = await LeadDropReason.findById(request.params.id);
      if (!reason) throw AppError.notFound('Drop tag not found');
      reason.name = request.body.name;
      await reason.save();
      return ok(reason.toJSON());
    },
  });

  r.route({
    method: 'DELETE',
    url: '/drop-reasons/:id',
    preHandler: [app.requireOrganizer],
    schema: {
      tags: ['lookups'],
      summary: 'Remove a drop tag (organizers only)',
      description:
        'Deleted outright: a dropped lead keeps its reason as text, so nothing ' +
        'references the tag and there is no history to preserve.',
      security,
      params: idParam,
      response: { 200: messageEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const reason = await LeadDropReason.findByIdAndDelete(request.params.id);
      if (!reason) throw AppError.notFound('Drop tag not found');
      return message('Drop tag removed');
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
      description:
        '`search` matches the shortcut or the message. The app always sent it; ' +
        'until it was declared here it was silently ignored.',
      security,
      querystring: paginationQuery.extend({ search: z.string().trim().max(120).optional() }),
      response: { 200: listEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const filter: Record<string, unknown> = { createdByUser: requireUserId() };
      const { search } = request.query;
      if (search) {
        const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filter.$or = [{ shortcut: regex }, { message: regex }];
      }

      const { page, limit, skip } = pageParams(request.query);
      const [rows, total] = await Promise.all([
        QuickReply.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
        QuickReply.countDocuments(filter),
      ]);
      return paginated(rows.map((row) => row.toJSON()), total, page, limit);
    },
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
