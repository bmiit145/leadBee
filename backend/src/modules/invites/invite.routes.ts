import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { inviteService } from './invite.service.js';
import {
  acceptInviteBody,
  addMemberByEmailBody,
  decideRequestBody,
  issueLinkBody,
  joinCodeBody,
  joinSettingsBody,
  listInvitesQuery,
  listRequestsQuery,
  previewQuery,
  requestIdParam,
  updateLinkBody,
} from './invite.schema.js';
import { commonErrors, idParam, listEnvelope, messageEnvelope, okEnvelope } from '../../lib/schemas.js';
import { message, ok, paginated } from '../../lib/response.js';
import { viewerOf } from '../../lib/viewer.js';
import { PERMISSIONS, type Role } from '../../config/constants.js';

const tenantSecurity = [{ tenantToken: [] }];
const accountSecurity = [{ accountToken: [] }];

/** Only someone who may manage people may open a door into the organization. */
const MANAGE_MEMBERS = [PERMISSIONS.USERS_MANAGE];

const conflict = { 409: commonErrors[400] };

/**
 * Admin side: the public join link and policy, adding an existing account,
 * and reviewing people asking to join.
 */
export async function inviteRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('preHandler', app.authenticateTenant);

  // Members may join a second organization with the same code/QR workflow.
  // Their person identity comes from the verified tenant token, never input.
  r.route({
    method: 'GET',
    url: '/join/preview',
    config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
    schema: { tags: ['join'], summary: 'Preview a join code from a membership session', security: tenantSecurity, querystring: previewQuery, response: { 200: okEnvelope, ...commonErrors } },
    handler: async (request) => ok(await inviteService.previewForAccountId(request.auth!.accountId, request.query.code)),
  });

  r.route({
    method: 'POST',
    url: '/join',
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
    schema: { tags: ['join'], summary: 'Join another organization with a shareable code', security: tenantSecurity, body: joinCodeBody, response: { 200: okEnvelope, 202: okEnvelope, ...commonErrors, ...conflict, 402: commonErrors[400] } },
    handler: async (request, reply) => {
      const outcome = await inviteService.joinForAccountId(request.auth!.accountId, request.body.code, request.body.message);
      if (outcome.kind === 'requested') {
        return reply.status(202).send(ok({ status: 'requested', request: outcome.request, organizationName: outcome.organizationName }));
      }
      request.log.info({ orgId: outcome.session.organization._id.toString() }, 'joined another organization with an invite code');
      return ok(sessionBody(outcome.session));
    },
  });

  r.route({
    method: 'GET',
    url: '/settings',
    preHandler: [app.requirePermission(...MANAGE_MEMBERS)],
    schema: { tags: ['invites'], summary: 'Organization link and join settings', security: tenantSecurity, response: { 200: okEnvelope, ...commonErrors } },
    handler: async () => ok(await inviteService.joinSettings()),
  });

  r.route({
    method: 'PATCH',
    url: '/settings',
    preHandler: [app.requirePermission(...MANAGE_MEMBERS)],
    schema: { tags: ['invites'], summary: 'Change organization link and join settings', security: tenantSecurity, body: joinSettingsBody, response: { 200: okEnvelope, ...commonErrors } },
    handler: async (request) => ok(await inviteService.updateJoinSettings(viewerOf(request), request.body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    })),
  });

  r.route({
    method: 'POST',
    url: '/members',
    preHandler: [app.requirePermission(...MANAGE_MEMBERS)],
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
    schema: { tags: ['invites'], summary: 'Add an existing LeadBee account by email', security: tenantSecurity, body: addMemberByEmailBody, response: { 201: okEnvelope, ...commonErrors } },
    handler: async (request, reply) => reply.status(201).send(ok(await inviteService.addExistingMemberByEmail(
      viewerOf(request),
      request.body.email,
      { ip: request.ip, userAgent: request.headers['user-agent'] }
    ))),
  });

  // ─── The shareable link ───────────────────────────────────────────────────
  r.route({
    method: 'GET',
    url: '/link',
    preHandler: [app.requirePermission(...MANAGE_MEMBERS)],
    schema: {
      tags: ['invites'],
      summary: 'The organization’s invite link',
      description: '`null` until one is issued. The code is formatted for display.',
      security: tenantSecurity,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async () => ok({ link: await inviteService.activeLink() }),
  });

  r.route({
    method: 'POST',
    url: '/link',
    preHandler: [app.requirePermission(...MANAGE_MEMBERS)],
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    schema: {
      tags: ['invites'],
      summary: 'Issue the invite link, replacing any current one',
      description:
        'This is also "Reset link": the previous code is retired at once, so every ' +
        'copy of the old link stops working.',
      security: tenantSecurity,
      body: issueLinkBody,
      response: { 201: okEnvelope, ...commonErrors },
    },
    handler: async (request, reply) => {
      const link = await inviteService.issueLink(viewerOf(request), {
        role: request.body.role as Role | undefined,
        expiresInDays: request.body.expiresInDays,
        maxUses: request.body.maxUses,
      });
      return reply.status(201).send(ok({ link }));
    },
  });

  r.route({
    method: 'PATCH',
    url: '/link',
    preHandler: [app.requirePermission(...MANAGE_MEMBERS)],
    schema: {
      tags: ['invites'],
      summary: 'Change the link’s settings without changing the code',
      description: 'Approval requirement, the role it grants, its expiry and its use limit.',
      security: tenantSecurity,
      body: updateLinkBody,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) =>
      ok({
        link: await inviteService.updateLink(viewerOf(request), {
          role: request.body.role as Role | undefined,
          expiresInDays: request.body.expiresInDays,
          maxUses: request.body.maxUses,
        }),
      }),
  });

  r.route({
    method: 'DELETE',
    url: '/link',
    preHandler: [app.requirePermission(...MANAGE_MEMBERS)],
    schema: {
      tags: ['invites'],
      summary: 'Turn the invite link off',
      security: tenantSecurity,
      response: { 200: messageEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      await inviteService.revokeLink(viewerOf(request));
      return message('Invite link turned off');
    },
  });

  r.route({
    method: 'GET',
    url: '/',
    preHandler: [app.requirePermission(...MANAGE_MEMBERS)],
    schema: {
      tags: ['invites'],
      summary: 'Invitations sent from this organization',
      security: tenantSecurity,
      querystring: listInvitesQuery,
      response: { 200: listEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const { data, total, page, limit } = await inviteService.listInvites(request.query);
      return paginated(data, total, page, limit);
    },
  });

  r.route({
    method: 'DELETE',
    url: '/:id',
    preHandler: [app.requirePermission(...MANAGE_MEMBERS)],
    schema: {
      tags: ['invites'],
      summary: 'Withdraw an invitation',
      security: tenantSecurity,
      params: idParam,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) =>
      ok(await inviteService.revokeInvite(request.params.id, viewerOf(request))),
  });

  // ─── Requests to join ─────────────────────────────────────────────────────
  r.route({
    method: 'GET',
    url: '/requests',
    preHandler: [app.requirePermission(...MANAGE_MEMBERS)],
    schema: {
      tags: ['invites'],
      summary: 'People asking to join',
      security: tenantSecurity,
      querystring: listRequestsQuery,
      response: { 200: listEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const { data, total, page, limit } = await inviteService.listRequests(request.query);
      return paginated(data, total, page, limit);
    },
  });

  r.route({
    method: 'GET',
    url: '/pending-count',
    preHandler: [app.requirePermission(...MANAGE_MEMBERS)],
    schema: {
      tags: ['invites'],
      summary: 'How many requests and invitations are outstanding',
      security: tenantSecurity,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async () => ok(await inviteService.pendingCounts()),
  });

  for (const decision of ['approve', 'reject'] as const) {
    r.route({
      method: 'POST',
      url: `/requests/:requestId/${decision}`,
      preHandler: [app.requirePermission(...MANAGE_MEMBERS)],
      schema: {
        tags: ['invites'],
        summary:
          decision === 'approve'
            ? 'Let someone in — creates their membership'
            : 'Turn a request down',
        security: tenantSecurity,
        params: requestIdParam,
        body: decideRequestBody,
        response: { 200: okEnvelope, ...commonErrors, ...conflict, 402: commonErrors[400] },
      },
      handler: async (request) =>
        ok(
          await inviteService.decideRequest(
            request.params.requestId,
            decision,
            viewerOf(request),
            { role: request.body.role as Role | undefined }
          )
        ),
    });
  }
}

/**
 * The joining side, for a person who has registered but belongs to no
 * organization yet (ADR-0004). Account realm only: there is no tenant to scope
 * to until one of these succeeds.
 *
 * Every lookup here is deliberately cross-tenant — a code is presented without
 * saying which organization it belongs to — and every one of them is a read of
 * exactly one row, by a secret the caller already holds.
 */
export async function joinRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('preHandler', app.authenticateAccount);

  r.route({
    method: 'GET',
    url: '/preview',
    // Guessing costs: a code is 8 characters from a 25-letter alphabet.
    config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
    schema: {
      tags: ['join'],
      summary: 'What an invite code leads to',
      description:
        'Nothing is joined or written. Every unusable code answers 404 `INVITE_INVALID`, ' +
        'so a guess cannot tell a wrong code from an expired one.',
      security: accountSecurity,
      querystring: previewQuery,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) =>
      ok(await inviteService.preview(request.query.code, request.accountAuth!.account)),
  });

  r.route({
    method: 'POST',
    url: '/',
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
    schema: {
      tags: ['join'],
      summary: 'Use an invite code',
      description:
        'When the link needs approval this raises a request (202). Otherwise the ' +
        'membership is created and the answer is a tenant session, the same shape ' +
        'as sign-in.',
      security: accountSecurity,
      body: joinCodeBody,
      response: { 200: okEnvelope, 202: okEnvelope, ...commonErrors, ...conflict, 402: commonErrors[400] },
    },
    handler: async (request, reply) => {
      const outcome = await inviteService.join(
        request.accountAuth!.account,
        request.body.code,
        request.body.message
      );
      if (outcome.kind === 'requested') {
        return reply.status(202).send(
          ok({ status: 'requested', request: outcome.request, organizationName: outcome.organizationName })
        );
      }
      request.log.info(
        { orgId: outcome.session.organization._id.toString() },
        'joined an organization with an invite code'
      );
      return ok(sessionBody(outcome.session));
    },
  });

  r.route({
    method: 'POST',
    url: '/accept',
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
    schema: {
      tags: ['join'],
      summary: 'Accept an invitation sent to your email',
      description:
        'Refused with 403 `INVITE_EMAIL_MISMATCH` when signed in as anyone other than ' +
        'the person invited. Single use.',
      security: accountSecurity,
      body: acceptInviteBody,
      response: { 200: okEnvelope, ...commonErrors, ...conflict, 402: commonErrors[400] },
    },
    handler: async (request) => {
      const outcome = await inviteService.acceptInvite(
        request.accountAuth!.account,
        request.body.token
      );
      if (outcome.kind !== 'joined') throw new Error('unreachable: accepting always joins');
      request.log.info(
        { orgId: outcome.session.organization._id.toString() },
        'accepted an invitation'
      );
      return ok(sessionBody(outcome.session));
    },
  });

  r.route({
    method: 'GET',
    url: '/invitations',
    schema: {
      tags: ['join'],
      summary: 'Invitations addressed to you',
      description:
        'Without their tokens — those live only in the links you were sent. Use one to ' +
        'ask the sender to share it again.',
      security: accountSecurity,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) =>
      ok(await inviteService.myInvitations(request.accountAuth!.account)),
  });

  r.route({
    method: 'GET',
    url: '/requests',
    schema: {
      tags: ['join'],
      summary: 'Requests you have raised',
      security: accountSecurity,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => ok(await inviteService.myRequests(request.accountAuth!.account)),
  });

  r.route({
    method: 'DELETE',
    url: '/requests/:requestId',
    schema: {
      tags: ['join'],
      summary: 'Withdraw your request',
      security: accountSecurity,
      params: requestIdParam,
      response: { 200: messageEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      await inviteService.cancelMyRequest(
        request.accountAuth!.account,
        request.params.requestId
      );
      return message('Request withdrawn');
    },
  });
}

/** The sign-in response shape, so a join lands the app exactly where login does. */
function sessionBody(session: {
  user: { toJSON(): unknown };
  organization: { toJSON(): unknown };
  tokens: { accessToken: string; refreshToken: string };
}) {
  return {
    session: 'tenant',
    status: 'joined',
    user: session.user.toJSON(),
    organization: session.organization.toJSON(),
    accessToken: session.tokens.accessToken,
    refreshToken: session.tokens.refreshToken,
  };
}
