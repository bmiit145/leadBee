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

/** Reading meetings, and acting on ones the caller takes part in (decided per meeting in the service). */
const MEETING_ACCESS = [PERMISSIONS.MEETINGS_VIEW, PERMISSIONS.MEETINGS_MANAGE];

/**
 * Booking. Anyone who can work a lead can book a meeting on it — an agent's
 * own lead included — which is what the lead screen's "Schedule meeting"
 * button offers them.
 */
const MEETING_BOOKING = [PERMISSIONS.MEETINGS_MANAGE, PERMISSIONS.LEADS_EDIT];

const createMeetingBody = z.object({
  leadId: objectIdSchema,
  scheduledAt: z.string().datetime({ offset: true }),
  durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
  assignedTo: z.array(objectIdSchema).max(50).optional(),
  meetingType: z.enum(MEETING_TYPE_ORDER as [string, ...string[]]),
  purpose: objectIdSchema.optional(),
  notes: z.string().trim().max(5000).optional(),
  reminderMinutesBefore: z.array(z.number().int().min(0)).max(10).optional(),
  /** Typed on the create form before the meeting existed; authored by the caller. */
  comments: z
    .array(z.object({ text: z.string().trim().min(1).max(5000) }))
    .max(50)
    .optional(),
});

const updateMeetingBody = createMeetingBody.partial().omit({ leadId: true, comments: true });

const meetingFilters = {
  leadId: objectIdSchema.optional(),
  assignedTo: objectIdSchema.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  /** Customer name, mobile or lead number, or the meeting number. */
  search: z.string().trim().max(120).optional(),
  meetingType: z.enum(MEETING_TYPE_ORDER as [string, ...string[]]).optional(),
  purpose: objectIdSchema.optional(),
};

const listMeetingsQuery = paginationQuery.extend({
  ...meetingFilters,
  status: z.enum(MEETING_STATUS_ORDER as [string, ...string[]]).optional(),
  scope: z
    .enum(['today', 'tomorrow', 'upcoming', 'completed', 'cancelled', 'rescheduled', 'missed', 'past'])
    .optional(),
});

const tabCountsQuery = z.object(meetingFilters);

const slotsQuery = z.object({
  /** `YYYY-MM-DD`, read in the caller's time zone. */
  date: z.string().min(1, 'date is required'),
  durationMinutes: z.coerce.number().int().min(5).max(480).default(30),
  /** Comma-separated user ids — availability is per-attendee. */
  userIds: z.string().optional(),
  /** Same, under the name app builds before this release sent. */
  assignedTo: z.string().optional(),
  excludeMeetingId: objectIdSchema.optional(),
});

export async function meetingRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('preHandler', app.authenticateTenant);

  r.route({
    method: 'GET',
    url: '/slots',
    preHandler: [app.requirePermission(...MEETING_ACCESS, PERMISSIONS.LEADS_EDIT)],
    schema: {
      tags: ['meetings'],
      summary: 'Free / busy / past slots for a day, across the chosen attendees',
      description:
        'Computed in the caller’s time zone (`X-Timezone`). With no attendees, ' +
        'the caller’s own calendar.',
      security,
      querystring: slotsQuery,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const { date, durationMinutes, userIds, assignedTo, excludeMeetingId } = request.query;
      const raw = userIds ?? assignedTo;
      const ids = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
      return ok(
        await meetingService.getSlots(date, durationMinutes, ids, excludeMeetingId, viewerOf(request))
      );
    },
  });

  r.route({
    method: 'GET',
    url: '/stats/tab-counts',
    preHandler: [app.requirePermission(...MEETING_ACCESS)],
    schema: {
      tags: ['meetings'],
      summary: 'How many meetings each list tab holds',
      description:
        'All, Today, Tomorrow, Upcoming, Completed, Cancelled, Rescheduled and ' +
        'Missed, under the list’s own filters so each number matches its rows.',
      security,
      querystring: tabCountsQuery,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => ok(await meetingService.tabCounts(request.query, viewerOf(request))),
  });

  r.route({
    method: 'GET',
    url: '/',
    preHandler: [app.requirePermission(...MEETING_ACCESS)],
    schema: {
      tags: ['meetings'],
      summary: 'List meetings',
      description:
        'Organizers see every meeting; everyone else meetings they attend or ' +
        'booked. With `leadId`, every meeting on that lead, for anyone who can see it.',
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
    preHandler: [app.requirePermission(...MEETING_BOOKING)],
    schema: {
      tags: ['meetings'],
      summary: 'Book a meeting (also raises its follow-up task)',
      description:
        'The lead must be one the caller can see. 409 `MEETING_CONFLICT` when an ' +
        'attendee is already booked then; 400 `MEETING_IN_PAST` for a past time.',
      security,
      body: createMeetingBody,
      response: { 201: okEnvelope, ...commonErrors, 409: commonErrors[400] },
    },
    handler: async (request, reply) => {
      const meeting = await meetingService.create(request.body, viewerOf(request));
      return reply.status(201).send(ok(meeting));
    },
  });

  r.route({
    method: 'GET',
    url: '/:id',
    preHandler: [app.requirePermission(...MEETING_ACCESS)],
    schema: {
      tags: ['meetings'],
      summary: 'Get one meeting (attendees, its booker, organizers, the lead’s owner)',
      security,
      params: idParam,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => ok(await meetingService.getById(request.params.id, viewerOf(request))),
  });

  r.route({
    method: 'PUT',
    url: '/:id',
    preHandler: [app.requirePermission(...MEETING_ACCESS)],
    schema: {
      tags: ['meetings'],
      summary: 'Reschedule or edit a meeting',
      description:
        'Moving the time marks it `rescheduled`, moves its task and notifies the ' +
        'attendees. 409 `MEETING_CLOSED` for a completed or cancelled meeting.',
      security,
      params: idParam,
      body: updateMeetingBody,
      response: { 200: okEnvelope, ...commonErrors, 409: commonErrors[400] },
    },
    handler: async (request) =>
      ok(await meetingService.update(request.params.id, request.body, viewerOf(request))),
  });

  r.route({
    method: 'PATCH',
    url: '/:id/status',
    preHandler: [app.requirePermission(...MEETING_ACCESS)],
    schema: {
      tags: ['meetings'],
      summary: 'Complete, cancel or reopen — the linked task follows',
      security,
      params: idParam,
      body: z.object({
        status: z.enum(MEETING_STATUS_ORDER as [string, ...string[]]),
        outcome: z.string().trim().max(2000).optional(),
      }),
      response: { 200: okEnvelope, ...commonErrors, 409: commonErrors[400] },
    },
    handler: async (request) =>
      ok(
        await meetingService.setStatus(
          request.params.id,
          request.body.status as MeetingStatus,
          request.body.outcome,
          viewerOf(request)
        )
      ),
  });

  r.route({
    method: 'POST',
    url: '/:id/comments',
    preHandler: [app.requirePermission(...MEETING_ACCESS)],
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
    preHandler: [app.requirePermission(...MEETING_ACCESS)],
    schema: {
      tags: ['meetings'],
      summary: 'Soft-delete a meeting and its auto-created task (its booker or an organizer)',
      security,
      params: idParam,
      response: { 200: messageEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      await meetingService.remove(request.params.id, viewerOf(request));
      return message('Meeting deleted');
    },
  });
}
