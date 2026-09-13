import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { accountService } from './account.service.js';
import { registerBody, resendVerificationBody, verifyEmailBody } from './account.schema.js';
import { commonErrors, errorEnvelope, okEnvelope } from '../../lib/schemas.js';
import { ok } from '../../lib/response.js';

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
}
