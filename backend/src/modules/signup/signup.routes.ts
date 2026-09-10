import type { FastifyInstance } from 'fastify';
import type { CountryCode } from 'libphonenumber-js';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { organizationService, normalizeSlug } from '../organizations/organization.service.js';
import { authService } from '../auth/auth.service.js';
import { commonErrors, okEnvelope } from '../../lib/schemas.js';
import { ok } from '../../lib/response.js';
import { AppError } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { normalizePhoneNumberOrThrow } from '../../lib/phoneNumber.js';

const signupBody = z.object({
  organizationName: z.string().trim().min(2, 'Organization name is required').max(120),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens only')
    .optional(),
  ownerName: z.string().trim().min(2, 'Your name is required').max(80),
  ownerPhone: z.string().trim().min(3, 'A valid phone number is required').max(30),
  ownerEmail: z.string().email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  country: z.string().trim().toUpperCase().length(2).optional(),
});

function countryCode(value: string | undefined): CountryCode {
  return (value ?? 'IN') as CountryCode;
}

export async function signupRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'POST',
    url: '/',
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
    schema: {
      tags: ['signup'],
      summary: 'Create an organization and its owner (self-serve)',
      description:
        'Creates a trialing organization, its built-in roles, an owner user and ' +
        'starter lookups, then signs the owner in. Phone numbers are normalized ' +
        'to E.164 before persistence. Disabled when `ALLOW_SELF_SERVE_SIGNUP=false`.',
      body: signupBody,
      response: { 201: okEnvelope, ...commonErrors },
    },
    handler: async (request, reply) => {
      if (!env.ALLOW_SELF_SERVE_SIGNUP) {
        throw AppError.forbidden(
          'Self-serve signup is disabled. Contact sales to have an organization provisioned.'
        );
      }

      const body = request.body;
      let ownerPhone: string;
      try {
        ownerPhone = normalizePhoneNumberOrThrow(body.ownerPhone, countryCode(body.country));
      } catch (error) {
        throw AppError.badRequest(error instanceof Error ? error.message : 'Enter a valid phone number');
      }

      const { organization, owner } = await organizationService.provision({
        organizationName: body.organizationName,
        slug: body.slug,
        ownerName: body.ownerName,
        ownerPhone,
        ownerEmail: body.ownerEmail,
        ownerPassword: body.password,
        source: 'self_serve',
      });

      const result = await authService.login(ownerPhone, body.password, organization._id.toString());
      if ('needsOrgSelection' in result) {
        throw AppError.internal('Unexpected organization ambiguity after signup');
      }

      request.log.info(
        { orgId: organization._id.toString(), slug: organization.slug },
        'organization provisioned via self-serve signup'
      );

      return reply.status(201).send(
        ok({
          user: owner.toJSON(),
          organization: organization.toJSON(),
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
        })
      );
    },
  });

  r.route({
    method: 'GET',
    url: '/slug-available',
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['signup'],
      summary: 'Check whether an organization handle is free',
      querystring: z.object({ slug: z.string().trim().min(1) }),
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      let normalized: string;
      try {
        normalized = normalizeSlug(request.query.slug);
      } catch {
        return ok({ slug: request.query.slug, available: false, reason: 'too_short' });
      }
      const available = await organizationService.isSlugAvailable(normalized);
      return ok({ slug: normalized, available });
    },
  });
}
