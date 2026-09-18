import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { leadTransferService } from './leadTransfer.service.js';
import {
  createTransferBody,
  decideTransferBody,
  leadIdParam,
  listTransfersQuery,
  recipientsQuery,
} from './leadTransfer.schema.js';
import type { TransferDecision } from './leadTransferPolicy.js';
import { commonErrors, idParam, listEnvelope, okEnvelope } from '../../lib/schemas.js';
import { ok, paginated } from '../../lib/response.js';
import { viewerOf } from '../../lib/viewer.js';
import { PERMISSIONS } from '../../config/constants.js';

const security = [{ tenantToken: [] }];

/**
 * Transferring changes who owns a lead, so it needs `leads.edit` — which every
 * built-in role holds, so no stored role has to change. Who may act on *which*
 * lead or request is the service's rule (leadTransferPolicy), not the route's.
 */
const TRANSFER_WRITE = [PERMISSIONS.LEADS_EDIT];
const TRANSFER_READ = [PERMISSIONS.LEADS_VIEW, PERMISSIONS.LEADS_EDIT];

/** 409s carry a TRANSFER_* code in `error.code`; see leadTransferPolicy. */
const conflict = { 409: commonErrors[400] };

export async function leadTransferRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('preHandler', app.authenticateTenant);

  r.route({
    method: 'GET',
    url: '/',
    preHandler: [app.requirePermission(...TRANSFER_READ)],
    schema: {
      tags: ['lead-transfers'],
      summary: 'List transfer requests',
      description:
        '`received` — waiting on, or answered by, the caller. `sent` — asked by the ' +
        'caller or on their behalf. `all` — the whole organization (organizers only).',
      security,
      querystring: listTransfersQuery,
      response: { 200: listEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const { data, total, page, limit } = await leadTransferService.list(
        request.query,
        viewerOf(request)
      );
      return paginated(data, total, page, limit);
    },
  });

  r.route({
    method: 'GET',
    url: '/pending-count',
    preHandler: [app.requirePermission(...TRANSFER_READ)],
    schema: {
      tags: ['lead-transfers'],
      summary: 'How many requests are waiting on the caller',
      security,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) =>
      ok({ count: await leadTransferService.pendingCount(viewerOf(request)) }),
  });

  r.route({
    method: 'GET',
    url: '/recipients',
    preHandler: [app.requirePermission(...TRANSFER_WRITE)],
    schema: {
      tags: ['lead-transfers'],
      summary: 'Colleagues a lead can be transferred to',
      description: 'Active members of the organization other than the caller: name, role, picture.',
      security,
      querystring: recipientsQuery,
      response: { 200: listEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const { data, total, page, limit } = await leadTransferService.recipients(
        request.query,
        viewerOf(request)
      );
      return paginated(data, total, page, limit);
    },
  });

  r.route({
    method: 'GET',
    url: '/lead/:leadId',
    preHandler: [app.requirePermission(...TRANSFER_READ)],
    schema: {
      tags: ['lead-transfers'],
      summary: 'A lead’s open transfer request and its transfer history',
      security,
      params: leadIdParam,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) =>
      ok(await leadTransferService.forLead(request.params.leadId, viewerOf(request))),
  });

  r.route({
    method: 'POST',
    url: '/',
    preHandler: [app.requirePermission(...TRANSFER_WRITE)],
    schema: {
      tags: ['lead-transfers'],
      summary: 'Transfer a lead to a colleague',
      description:
        'From the lead’s owner this creates a request the recipient must accept. ' +
        'From an organizer the lead moves at once (`completed: true`). ' +
        '409 `TRANSFER_PENDING` when the lead already has an open request.',
      security,
      body: createTransferBody,
      response: { 201: okEnvelope, ...commonErrors, ...conflict },
    },
    handler: async (request, reply) => {
      const result = await leadTransferService.request(request.body, viewerOf(request));
      return reply.status(201).send(ok(result));
    },
  });

  const decisions: Array<{ decision: TransferDecision; summary: string }> = [
    { decision: 'accept', summary: 'Accept a transfer — the lead becomes yours' },
    { decision: 'decline', summary: 'Decline a transfer — the lead stays where it is' },
    { decision: 'cancel', summary: 'Withdraw a transfer you asked for' },
  ];

  for (const { decision, summary } of decisions) {
    r.route({
      method: 'POST',
      url: `/:id/${decision}`,
      preHandler: [app.requirePermission(...TRANSFER_WRITE)],
      schema: {
        tags: ['lead-transfers'],
        summary,
        description:
          '409 `TRANSFER_NOT_PENDING` when it was already answered, withdrawn or has ' +
          'lapsed; 409 `TRANSFER_STALE` when the lead or recipient changed meanwhile.',
        security,
        params: idParam,
        body: decideTransferBody,
        response: { 200: okEnvelope, ...commonErrors, ...conflict },
      },
      handler: async (request) =>
        ok(
          await leadTransferService.decide(
            request.params.id,
            decision,
            viewerOf(request),
            request.body.note
          )
        ),
    });
  }
}
