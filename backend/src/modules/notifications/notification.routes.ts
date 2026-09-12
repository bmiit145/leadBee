import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { notificationService } from './notification.service.js';
import { listNotificationsQuery } from './notification.schema.js';
import { commonErrors, idParam, listEnvelope, okEnvelope } from '../../lib/schemas.js';
import { ok, paginated } from '../../lib/response.js';
import { viewerOf } from '../../lib/viewer.js';

const security = [{ tenantToken: [] }];

/**
 * The signed-in user's own inbox.
 *
 * Authentication is the whole guard, deliberately: the service pins every query
 * to the caller as recipient, so no permission could widen what a caller
 * reaches — only their own rows exist to them.
 */
export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/',
    preHandler: [app.authenticateTenant],
    schema: {
      tags: ['notifications'],
      summary: 'Your notifications, newest first',
      security,
      querystring: listNotificationsQuery,
      response: { 200: listEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const { data, total, page, limit } = await notificationService.list(
        viewerOf(request),
        request.query
      );
      return paginated(data, total, page, limit);
    },
  });

  r.route({
    method: 'GET',
    url: '/unread-count',
    preHandler: [app.authenticateTenant],
    schema: {
      tags: ['notifications'],
      summary: 'How many of your notifications are unread',
      security,
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ count: z.number() }) }),
        ...commonErrors,
      },
    },
    handler: async (request) =>
      ok({ count: await notificationService.unreadCount(viewerOf(request)) }),
  });

  r.route({
    method: 'PATCH',
    url: '/:id/read',
    preHandler: [app.authenticateTenant],
    schema: {
      tags: ['notifications'],
      summary: 'Mark one of your notifications read',
      security,
      params: idParam,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) =>
      ok(await notificationService.markRead(request.params.id, viewerOf(request))),
  });

  r.route({
    method: 'POST',
    url: '/read-all',
    preHandler: [app.authenticateTenant],
    schema: {
      tags: ['notifications'],
      summary: 'Mark every one of your notifications read',
      security,
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ updated: z.number() }) }),
        ...commonErrors,
      },
    },
    handler: async (request) =>
      ok({ updated: await notificationService.markAllRead(viewerOf(request)) }),
  });
}
