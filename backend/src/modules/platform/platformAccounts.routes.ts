import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  commonErrors,
  idParam,
  listEnvelope,
  messageEnvelope,
  okEnvelope,
  paginationQuery,
} from '../../lib/schemas.js';
import { message, ok, paginated } from '../../lib/response.js';
import { ACCOUNT_STATUSES } from '../../models/Account.js';
import { platformAccountsService } from './platformAccounts.service.js';

const security = [{ platformToken: [] }];

const accountStatusSchema = z.enum([ACCOUNT_STATUSES.ACTIVE, ACCOUNT_STATUSES.SUSPENDED]);
const reasonSchema = z.string().trim().min(3, 'Give a reason of at least 3 characters').max(500);

/**
 * Registered people, as seen from the control plane.
 *
 * Permissions: `accounts.view` to read, `accounts.manage` to suspend, reactivate,
 * verify or annotate, `accounts.delete` to erase. Deletion is deliberately not
 * granted to operators — only an owner holds it (via `*`).
 */
export async function platformAccountRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (secured) => {
    const s = secured.withTypeProvider<ZodTypeProvider>();
    s.addHook('preHandler', app.authenticatePlatform);

    s.route({
      method: 'GET',
      url: '/accounts',
      preHandler: [app.requirePlatformPermission('accounts.view')],
      schema: {
        tags: ['platform'],
        summary: 'List registered accounts',
        description: '`search` matches name, email or mobile; every word must match.',
        security,
        querystring: paginationQuery.extend({
          search: z.string().trim().max(120).optional(),
          status: accountStatusSchema.optional(),
          verification: z.enum(['verified', 'unverified']).optional(),
          sort: z.enum(['newest', 'oldest', 'name']).optional(),
        }),
        response: { 200: listEnvelope, ...commonErrors },
      },
      handler: async (request) => {
        const { data, total, page, limit } = await platformAccountsService.listAccounts(
          request.query
        );
        return paginated(data, total, page, limit);
      },
    });

    // A static path: the router prefers it over `/accounts/:id` regardless of order.
    s.route({
      method: 'GET',
      url: '/accounts/stats',
      preHandler: [app.requirePlatformPermission('accounts.view')],
      schema: {
        tags: ['platform'],
        summary: 'Registration totals for the accounts console',
        security,
        response: { 200: okEnvelope, ...commonErrors },
      },
      handler: async () => ok(await platformAccountsService.stats()),
    });

    s.route({
      method: 'GET',
      url: '/accounts/:id',
      preHandler: [app.requirePlatformPermission('accounts.view')],
      schema: {
        tags: ['platform'],
        summary: 'One account, with its verification state and admin activity',
        security,
        params: idParam,
        response: { 200: okEnvelope, ...commonErrors },
      },
      handler: async (request) => ok(await platformAccountsService.getAccount(request.params.id)),
    });

    s.route({
      method: 'PATCH',
      url: '/accounts/:id/status',
      preHandler: [app.requirePlatformPermission('accounts.manage')],
      schema: {
        tags: ['platform'],
        summary: 'Suspend or reactivate an account',
        description:
          'A reason is required to suspend. Suspending retires any outstanding ' +
          'verification code. Repeating the current status is a no-op.',
        security,
        params: idParam,
        body: z.object({
          status: accountStatusSchema,
          reason: z.string().trim().max(500).optional(),
        }),
        response: { 200: okEnvelope, ...commonErrors },
      },
      handler: async (request) =>
        ok(
          await platformAccountsService.setStatus(
            request.params.id,
            request.body.status,
            request.platformAuth!.admin,
            request.body.reason,
            { ip: request.ip, userAgent: request.headers['user-agent'] }
          )
        ),
    });

    s.route({
      method: 'POST',
      url: '/accounts/:id/verify-email',
      preHandler: [app.requirePlatformPermission('accounts.manage')],
      schema: {
        tags: ['platform'],
        summary: 'Mark an account’s email verified (support override)',
        description: 'Answers 409 when the email is already verified.',
        security,
        params: idParam,
        body: z.object({ reason: reasonSchema }),
        response: { 200: okEnvelope, ...commonErrors, 409: commonErrors[400] },
      },
      handler: async (request) =>
        ok(
          await platformAccountsService.verifyEmail(
            request.params.id,
            request.platformAuth!.admin,
            request.body.reason,
            { ip: request.ip, userAgent: request.headers['user-agent'] }
          )
        ),
    });

    s.route({
      method: 'PATCH',
      url: '/accounts/:id/notes',
      preHandler: [app.requirePlatformPermission('accounts.manage')],
      schema: {
        tags: ['platform'],
        summary: 'Update internal notes (never visible to the account holder)',
        security,
        params: idParam,
        body: z.object({ internalNotes: z.string().trim().max(5000) }),
        response: { 200: okEnvelope, ...commonErrors },
      },
      handler: async (request) =>
        ok(
          await platformAccountsService.setNotes(request.params.id, request.body.internalNotes)
        ),
    });

    s.route({
      method: 'DELETE',
      url: '/accounts/:id',
      preHandler: [app.requirePlatformPermission('accounts.delete')],
      schema: {
        tags: ['platform'],
        summary: 'Permanently delete an account',
        description:
          '`confirmEmail` must equal the account’s email. The audit row keeps ' +
          'the email domain only.',
        security,
        params: idParam,
        body: z.object({
          reason: reasonSchema,
          confirmEmail: z.string().trim().min(3).max(254),
        }),
        response: { 200: messageEnvelope, ...commonErrors },
      },
      handler: async (request) => {
        await platformAccountsService.deleteAccount(
          request.params.id,
          request.platformAuth!.admin,
          request.body.reason,
          request.body.confirmEmail,
          { ip: request.ip, userAgent: request.headers['user-agent'] }
        );
        return message('Account deleted');
      },
    });
  });
}
