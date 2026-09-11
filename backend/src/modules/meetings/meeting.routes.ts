import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { meetingService } from './meeting.service.js';
import {
  MEETING_STATUS_ORDER,
  MEETING_TYPE_ORDER,
  type MeetingStatus,
} from '../../models/Meeting.js';
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
import { PERMISSIONS } from '../../config/constants.js';

const security = [{ tenantToken: [] }];

const createMeetingBody = z.object({
  leadId: objectIdSchema,
  scheduledAt: z.string().datetime({ offset: true }),
  durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
  assignedTo: z.array(objectIdSchema).optional(),
  meetingType: z.enum(MEETING_TYPE_ORDER as [string, ...string[]]),
  purpose: objectIdSchema.optional(),
  notes: z.string().trim().optional(),
  reminderMinutesBefore: z.array(z.number().int().min(0)).optional(),
});

const updateMeetingBody = createMeetingBody.partial().omit({ leadId: true });

const listMeetingsQuery = paginationQuery.extend({
  status: z.enum(MEETING_STATUS_ORDER as [string, ...string[]]).optional(),
  leadId: objectIdSchema.optional(),
  assignedTo: objectIdSchema.optional(),
  scope: z.enum(['today', 'tomorrow', 'upcoming', 'past']).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

const slotsQuery = z.object({
  date: z.string().min(1, 'date is required'),
  durationMinutes: z.coerce.number().int().min(5).max(480).default(30),
  /** Comma-separated user ids — availability is per-attendee. */
  userIds: z.string().optional(),
  excludeMeetingId: objectIdSchema.optional(),
});

export async function meetingRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('preHandler', app.authenticateTenant);

  r.route({
    method: 'GET',
    url: '/slots',
    schema: {
      tags: ['meetings'],
      summary: 'Free / busy / past slots for a day, across the chosen attendees',
      security,
      querystring: slotsQuery,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const { date, durationMinutes, userIds, excludeMeetingId } = request.query;
      const ids = userIds ? userIds.split(',').map((s) => s.trim()).filter(Boolean) : [];
      return ok(
        await meetingService.getSlots(date, durationMinutes, ids, excludeMeetingId)
      );
    },
  });

  r.route({
    method: 'GET',
    url: '/',
    preHandler: [app.requirePermission(PERMISSIONS.MEETINGS_VIEW)],
    schema: {
      tags: ['meetings'],
      summary: 'List meetings',
      security,
      querystring: listMeetingsQuery,
      response: { 200: listEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const { data, total, page, limit } = await meetingService.list(
        request.query,
        viewerOf(request)
      );
      return paginated(data, total, page, limit);
    },
  });

  r.route({
    method: 'POST',
    url: '/',
    preHandler: [app.requirePermission(PERMISSIONS.MEETINGS_MANAGE)],
    schema: {
      tags: ['meetings'],
      summary: 'Book a meeting (also raises its follow-up task)',
      security,
      body: createMeetingBody,
      response: { 201: okEnvelope, ...commonErrors },
    },
    handler: async (request, reply) => {
      const meeting = await meetingService.create(request.body, viewerOf(request));
      return reply.status(201).send(ok(meeting));
    },
  });

  r.route({
    method: 'GET',
    url: '/:id',
    preHandler: [app.requirePermission(PERMISSIONS.MEETINGS_VIEW)],
    schema: {
      tags: ['meetings'],
      summary: 'Get one meeting',
      security,
      params: idParam,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => ok(await meetingService.getById(request.params.id)),
  });

  r.route({
    method: 'PUT',
    url: '/:id',
    preHandler: [app.requirePermission(PERMISSIONS.MEETINGS_MANAGE)],
    schema: {
      tags: ['meetings'],
      summary: 'Reschedule or edit a meeting',
      security,
      params: idParam,
      body: updateMeetingBody,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) =>
      ok(await meetingService.update(request.params.id, request.body, viewerOf(request))),
  });

  r.route({
    method: 'PATCH',
    url: '/:id/status',
    preHandler: [app.requirePermission(PERMISSIONS.MEETINGS_MANAGE)],
    schema: {
      tags: ['meetings'],
      summary: 'Complete, cancel or reschedule — also resolves the linked task',
      security,
      params: idParam,
      body: z.object({
        status: z.enum(MEETING_STATUS_ORDER as [string, ...string[]]),
        outcome: z.string().trim().optional(),
      }),
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) =>
      ok(
        await meetingService.setStatus(
          request.params.id,
          request.body.status as MeetingStatus,
          request.body.outcome
        )
      ),
  });

  r.route({
    method: 'POST',
    url: '/:id/comments',
    schema: {
      tags: ['meetings'],
      summary: 'Post to the meeting’s purpose thread',
      security,
      params: idParam,
      body: z.object({ text: z.string().trim().min(1).max(5000) }),
      response: { 201: okEnvelope, ...commonErrors },
    },
    handler: async (request, reply) => {
      const meeting = await meetingService.addComment(
        request.params.id,
        request.body.text,
        viewerOf(request)
      );
      return reply.status(201).send(ok(meeting));
    },
  });

  r.route({
    method: 'DELETE',
    url: '/:id',
    preHandler: [app.requirePermission(PERMISSIONS.MEETINGS_MANAGE)],
    schema: {
      tags: ['meetings'],
      summary: 'Soft-delete a meeting and its auto-created task',
      security,
      params: idParam,
      response: { 200: messageEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      await meetingService.remove(request.params.id);
      return message('Meeting deleted');
    },
  });
}
