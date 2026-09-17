import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { callService } from './call.service.js';
import { CALL_DIRECTION_ORDER, type CallDirection } from '../../models/CallLog.js';
import {
  commonErrors,
  idParam,
  listEnvelope,
  objectIdSchema,
  okEnvelope,
  paginationQuery,
} from '../../lib/schemas.js';
import { ok, paginated } from '../../lib/response.js';
import { viewerOf } from '../../lib/viewer.js';
import { CALL_OUTCOME_ORDER, PERMISSIONS, type CallOutcome } from '../../config/constants.js';

const security = [{ tenantToken: [] }];

/**
 * Calls belong to leads, so seeing calls is seeing leads. Which calls each
 * person gets is decided in the service: an organizer sees the organization's,
 * everyone else their own.
 */
const CALL_ACCESS = [PERMISSIONS.LEADS_VIEW, PERMISSIONS.LEADS_EDIT];

const callFilters = {
  leadId: objectIdSchema.optional(),
  calledBy: objectIdSchema.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().trim().max(120).optional(),
};

const listCallsQuery = paginationQuery.extend({
  ...callFilters,
  direction: z.enum(CALL_DIRECTION_ORDER as unknown as [string, ...string[]]).optional(),
});

const statsQuery = z.object(callFilters);

const recordCallBody = z.object({
  leadId: objectIdSchema,
  calledAt: z.string().datetime({ offset: true }).optional(),
  phoneNumber: z.string().trim().max(32).optional(),
  /** Seconds. Usually absent at first: the call has only just been placed. */
  durationSeconds: z.coerce.number().int().min(0).max(86_400).optional(),
  outcome: z.enum(CALL_OUTCOME_ORDER as [string, ...string[]]).optional(),
});

const syncCallsBody = z.object({
  calls: z
    .array(
      z.object({
        deviceCallId: z.string().trim().min(1).max(64),
        leadId: objectIdSchema,
        phoneNumber: z.string().trim().max(32),
        direction: z.enum(CALL_DIRECTION_ORDER as unknown as [string, ...string[]]),
        calledAt: z.string().datetime({ offset: true }),
        durationSeconds: z.coerce.number().int().min(0).max(86_400).optional(),
      })
    )
    .max(500),
});

const completeCallBody = z.object({
  durationSeconds: z.coerce.number().int().min(0).max(86_400).optional(),
  outcome: z.enum(CALL_OUTCOME_ORDER as [string, ...string[]]).optional(),
});

export async function callRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('preHandler', app.authenticateTenant);

  r.route({
    method: 'GET',
    url: '/stats',
    preHandler: [app.requirePermission(...CALL_ACCESS)],
    schema: {
      tags: ['calls'],
      summary: 'Call counts and talk time per direction',
      description:
        'Under the same filters as the list. Only directions this build can ' +
        'measure appear; the rest are untracked, not zero.',
      security,
      querystring: statsQuery,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => ok(await callService.stats(request.query, viewerOf(request))),
  });

  r.route({
    method: 'GET',
    url: '/daily',
    preHandler: [app.requirePermission(...CALL_ACCESS)],
    schema: {
      tags: ['calls'],
      summary: 'Calls per day, for the activity trend',
      security,
      querystring: statsQuery,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => ok(await callService.daily(request.query, viewerOf(request))),
  });

  r.route({
    method: 'GET',
    url: '/activity',
    preHandler: [app.requirePermission(...CALL_ACCESS)],
    schema: {
      tags: ['calls'],
      summary: 'Who called, and which customers were called most',
      security,
      querystring: statsQuery,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => ok(await callService.activity(request.query, viewerOf(request))),
  });

  r.route({
    method: 'GET',
    url: '/',
    preHandler: [app.requirePermission(...CALL_ACCESS)],
    schema: {
      tags: ['calls'],
      summary: 'List calls',
      description: 'An organizer sees the organization’s calls; everyone else sees their own.',
      security,
      querystring: listCallsQuery,
      response: { 200: listEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const { direction, ...rest } = request.query;
      const { data, total, page, limit } = await callService.list(
        { ...rest, direction: direction as CallDirection | undefined },
        viewerOf(request)
      );
      return paginated(data, total, page, limit);
    },
  });

  r.route({
    method: 'POST',
    url: '/',
    preHandler: [app.requirePermission(...CALL_ACCESS)],
    schema: {
      tags: ['calls'],
      summary: 'Record a call placed from the app',
      description:
        'Written as the call is dialled, so it survives the app being killed. ' +
        'Its duration arrives afterwards through PATCH /calls/:id.',
      security,
      body: recordCallBody,
      response: { 201: okEnvelope, ...commonErrors },
    },
    handler: async (request, reply) => {
      const { leadId, calledAt, phoneNumber, durationSeconds, outcome } = request.body;
      const call = await callService.record(
        {
          leadId,
          calledAt: calledAt ? new Date(calledAt) : undefined,
          phoneNumber,
          durationSeconds,
          outcome: outcome as CallOutcome | undefined,
        },
        viewerOf(request)
      );
      return reply.status(201).send(ok(call));
    },
  });

  r.route({
    method: 'POST',
    url: '/sync',
    preHandler: [app.requirePermission(...CALL_ACCESS)],
    schema: {
      tags: ['calls'],
      summary: 'Sync calls the phone matched to a customer',
      description:
        'The device filters first: only calls matching a lead are sent. Writes ' +
        'are keyed on the phone’s own call id, so re-sending a window is safe.',
      security,
      body: syncCallsBody,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) =>
      ok(
        await callService.syncDevice(
          request.body.calls.map((call) => ({
            deviceCallId: call.deviceCallId,
            leadId: call.leadId,
            phoneNumber: call.phoneNumber,
            direction: call.direction as CallDirection,
            calledAt: new Date(call.calledAt),
            durationSeconds: call.durationSeconds,
          })),
          viewerOf(request)
        )
      ),
  });

  r.route({
    method: 'PATCH',
    url: '/:id',
    preHandler: [app.requirePermission(...CALL_ACCESS)],
    schema: {
      tags: ['calls'],
      summary: 'Complete a call: how long it lasted, and how it went',
      security,
      params: idParam,
      body: completeCallBody,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) =>
      ok(
        await callService.complete(
          request.params.id,
          {
            durationSeconds: request.body.durationSeconds,
            outcome: request.body.outcome as CallOutcome | undefined,
          },
          viewerOf(request)
        )
      ),
  });
}
