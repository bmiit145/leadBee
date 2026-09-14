import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { accountService } from './account.service.js';
import { accountSessionService } from './accountSession.service.js';
import { accountOrganizationService } from './accountOrganization.service.js';
import { createOrganizationBody } from './organization.schema.js';
import { registerBody, resendVerificationBody, verifyEmailBody } from './account.schema.js';
import { commonErrors, errorEnvelope, messageEnvelope, okEnvelope } from '../../lib/schemas.js';
import { message, ok } from '../../lib/response.js';

/**
 * Registration of a person, before any organization.
 *
 * **Public by design** (BE-11): these routes create and confirm an identity, so
 * there is no caller to authenticate yet. They are rate-limited per IP instead,
 * and answer identically for known and unknown addresses — see
 * `account.service.ts` for why.
 */
export async function accountRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'POST',
    url: '/register',
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    schema: {
      tags: ['accounts'],
      summary: 'Register a person (no organization yet)',
      description:
        'Always answers 202 with the same shape, whether or not the email is ' +
        'already registered. Keep `registrationToken` — verifying and resending ' +
        'both need it. `devCode` appears outside production only, because no ' +
        'email is delivered yet.',
      body: registerBody,
      response: { 202: okEnvelope, ...commonErrors, 503: errorEnvelope },
    },
    handler: async (request, reply) => {
      // Enforced by the schema; the consent time is stamped by the service.
      const { acceptedTerms: _acceptedTerms, ...details } = request.body;
      const receipt = await accountService.register(details, {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      return reply.status(202).send(ok(receipt));
    },
  });

  r.route({
    method: 'POST',
    url: '/verify-email',
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    schema: {
      tags: ['accounts'],
      summary: 'Confirm an email with the emailed code',
      description:
        'Every failure answers 400 `INVALID_VERIFICATION_CODE`, whatever the ' +
        'cause. Five wrong guesses retire the code.',
      body: verifyEmailBody,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => ok(await accountService.verifyEmail(request.body)),
  });

  r.route({
    method: 'POST',
    url: '/resend-verification',
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    schema: {
      tags: ['accounts'],
      summary: 'Send a fresh verification code',
      description: 'Honours a 30-second cooldown and answers 202 either way.',
      body: resendVerificationBody,
      response: { 202: okEnvelope, ...commonErrors, 503: errorEnvelope },
    },
    handler: async (request, reply) => {
      const receipt = await accountService.resendVerification(
        request.body.email,
        request.body.registrationToken
      );
      return reply.status(202).send(ok(receipt));
    },
  });

  // ─── Account session ────────────────────────────────────────────────────────
  // Held by a person who has signed in but belongs to no organization. See
  // accountSession.service.ts. Tenant and platform tokens are refused here.

  r.route({
    method: 'GET',
    url: '/me',
    preHandler: [app.authenticateAccount],
    schema: {
      tags: ['accounts'],
      summary: 'The signed-in person, when they belong to no organization',
      description:
        '`organizationCount` above zero means they have been added to an ' +
        'organization since signing in; sign in again to open it.',
      security: [{ accountToken: [] }],
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const { account, accountId } = request.accountAuth!;
      return ok({
        account: account.toJSON(),
        organizationCount: await accountSessionService.organizationCount(accountId),
      });
    },
  });

  r.route({
    method: 'POST',
    url: '/organizations',
    preHandler: [app.authenticateAccount],
    // Creates a tenant — expensive and abusable, like public signup.
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
    schema: {
      tags: ['accounts'],
      summary: 'Create an organization owned by the signed-in person, and open it',
      description:
        'Provisions the organization with this account as owner, ends every ' +
        'account session, and answers with a tenant session (`session: "tenant"`, ' +
        'user, organization, tokens) — the same shape as sign-in. 409 when the ' +
        'handle is taken or the person already belongs to an organization. ' +
        'Disabled when `ALLOW_SELF_SERVE_SIGNUP=false`.',
      security: [{ accountToken: [] }],
      body: createOrganizationBody,
      response: { 201: okEnvelope, ...commonErrors, 409: commonErrors[400] },
    },
    handler: async (request, reply) => {
      const result = await accountOrganizationService.create(
        request.accountAuth!.account,
        request.body,
        { via: 'account' }
      );

      request.log.info(
        { orgId: result.organization._id.toString(), slug: result.organization.slug },
        'organization created from an account session'
      );

      return reply.status(201).send(
        ok({
          session: 'tenant',
          user: result.user.toJSON(),
          organization: result.organization.toJSON(),
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
        })
      );
    },
  });

  r.route({
    method: 'POST',
    url: '/session/refresh',
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['accounts'],
      summary: 'Exchange an account refresh token for a new pair',
      body: z.object({ refreshToken: z.string().min(1) }),
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const { account, tokens } = await accountSessionService.refresh(request.body.refreshToken);
      return ok({
        session: 'account',
        account: account.toJSON(),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });
    },
  });

  r.route({
    method: 'POST',
    url: '/logout',
    preHandler: [app.authenticateAccount],
    schema: {
      tags: ['accounts'],
      summary: 'End this account session',
      security: [{ accountToken: [] }],
      body: z.object({ refreshToken: z.string().optional() }),
      response: { 200: messageEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      await accountSessionService.logout(request.accountAuth!.accountId, request.body.refreshToken);
      return message('Signed out');
    },
  });
}
