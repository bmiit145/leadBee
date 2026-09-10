import type { FastifyInstance } from 'fastify';
import type { CountryCode } from 'libphonenumber-js';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { platformAuthService } from './platformAuth.service.js';
import { platformService, recordPlatformAction } from './platform.service.js';
import { organizationService } from '../organizations/organization.service.js';
import { Organization } from '../../models/Organization.js';
import { AppError } from '../../lib/errors.js';
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
import { ORG_STATUSES, ROLES, type OrgStatus } from '../../config/constants.js';
import { normalizePhoneNumberOrThrow } from '../../lib/phoneNumber.js';

const security = [{ platformToken: [] }];

const statusEnum = z.enum(Object.values(ORG_STATUSES) as [string, ...string[]]);
const planKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Invalid plan key');
const countrySchema = z.string().trim().toUpperCase().length(2).optional();

function normalizePlatformPhone(input: string, country?: string): string {
  try {
    return normalizePhoneNumberOrThrow(input, (country ?? 'IN') as CountryCode);
  } catch (error) {
    throw AppError.badRequest(
      error instanceof Error ? error.message : 'Enter a valid phone number'
    );
  }
}

export async function platformRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'POST',
    url: '/auth/login',
    config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
    schema: {
      tags: ['platform'],
      summary: 'Superadmin sign-in',
      description:
        'Separate realm from tenant auth — different secret, different token ' +
        'audience. Responds 401 `TOTP_REQUIRED` when two-factor is enrolled.',
      body: z.object({
        email: z.string().email(),
        password: z.string().min(1),
        totp: z.string().trim().length(6).optional(),
      }),
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const { email, password, totp } = request.body;
      const { admin, tokens } = await platformAuthService.login(email, password, totp, request.ip);
      return ok({ admin: admin.toJSON(), accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    },
  });

  r.route({
    method: 'POST',
    url: '/auth/refresh',
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['platform'],
      summary: 'Rotate the control-plane token pair',
      body: z.object({ refreshToken: z.string().min(1) }),
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const { admin, tokens } = await platformAuthService.refresh(request.body.refreshToken);
      return ok({ admin: admin.toJSON(), accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    },
  });

  await app.register(async (secured) => {
    const s = secured.withTypeProvider<ZodTypeProvider>();
    s.addHook('preHandler', app.authenticatePlatform);

    s.route({
      method: 'GET', url: '/auth/me',
      schema: { tags: ['platform'], summary: 'The signed-in platform admin', security, response: { 200: okEnvelope, ...commonErrors } },
      handler: async (request) => ok({ admin: request.platformAuth!.admin.toJSON(), permissions: request.platformAuth!.permissions }),
    });

    s.route({
      method: 'POST', url: '/auth/logout',
      schema: { tags: ['platform'], summary: 'End this control-plane session', security, body: z.object({ refreshToken: z.string().optional() }), response: { 200: messageEnvelope, ...commonErrors } },
      handler: async (request) => {
        await platformAuthService.logout(request.platformAuth!.adminId, request.body.refreshToken);
        return message('Signed out');
      },
    });

    s.route({
      method: 'POST', url: '/auth/totp/begin',
      schema: { tags: ['platform'], summary: 'Start two-factor enrolment (returns a QR otpauth URL)', security, response: { 200: okEnvelope, ...commonErrors } },
      handler: async (request) => ok(await platformAuthService.beginTotpEnrolment(request.platformAuth!.adminId)),
    });

    s.route({
      method: 'POST', url: '/auth/totp/confirm',
      schema: { tags: ['platform'], summary: 'Confirm two-factor enrolment with a code', security, body: z.object({ code: z.string().trim().length(6) }), response: { 200: messageEnvelope, ...commonErrors } },
      handler: async (request) => {
        await platformAuthService.confirmTotpEnrolment(request.platformAuth!.adminId, request.body.code);
        return message('Two-factor authentication enabled');
      },
    });

    s.route({
      method: 'GET', url: '/metrics',
      preHandler: [app.requirePlatformPermission('metrics.view')],
      schema: { tags: ['platform'], summary: 'Estate-wide totals for the console landing page', security, response: { 200: okEnvelope, ...commonErrors } },
      handler: async () => ok(await platformService.metrics()),
    });

    s.route({
      method: 'GET', url: '/organizations',
      preHandler: [app.requirePlatformPermission('orgs.view')],
      schema: {
        tags: ['platform'], summary: 'List every tenant', security,
        querystring: paginationQuery.extend({ status: statusEnum.optional(), plan: planKeySchema.optional(), search: z.string().trim().optional(), sort: z.enum(['newest', 'oldest', 'name', 'users', 'leads']).optional() }),
        response: { 200: listEnvelope, ...commonErrors },
      },
      handler: async (request) => {
        const { data, total, page, limit } = await platformService.listOrganizations(request.query as Parameters<typeof platformService.listOrganizations>[0]);
        return paginated(data, total, page, limit);
      },
    });

    s.route({
      method: 'POST', url: '/organizations',
      preHandler: [app.requirePlatformPermission('orgs.create')],
      schema: {
        tags: ['platform'], summary: 'Provision a tenant and its owner', security,
        body: z.object({ organizationName: z.string().trim().min(2).max(120), slug: z.string().trim().min(3).max(50).regex(/^[a-z0-9-]+$/).optional(), ownerName: z.string().trim().min(2).max(80), ownerPhone: z.string().trim().min(3).max(30), ownerEmail: z.string().email(), ownerPassword: z.string().min(8), country: countrySchema, plan: planKeySchema.optional(), status: statusEnum.optional() }),
        response: { 201: okEnvelope, ...commonErrors },
      },
      handler: async (request, reply) => {
        const admin = request.platformAuth!.admin;
        const body = request.body;
        const ownerPhone = normalizePlatformPhone(body.ownerPhone, body.country);
        const { organization, owner } = await organizationService.provision({ organizationName: body.organizationName, slug: body.slug, ownerName: body.ownerName, ownerPhone, ownerEmail: body.ownerEmail, ownerPassword: body.ownerPassword, plan: body.plan, status: body.status as OrgStatus | undefined, source: 'platform_provisioned', provisionedBy: admin._id });
        await recordPlatformAction({ action: 'org_created', organization, admin, after: { plan: organization.plan, status: organization.status }, ip: request.ip, userAgent: request.headers['user-agent'] });
        return reply.status(201).send(ok({ organization: organization.toJSON(), owner: owner.toJSON() }));
      },
    });

    s.route({
      method: 'GET', url: '/organizations/:id',
      preHandler: [app.requirePlatformPermission('orgs.view')],
      schema: { tags: ['platform'], summary: 'One tenant, with authoritative counts and its owner', security, params: idParam, response: { 200: okEnvelope, ...commonErrors } },
      handler: async (request) => ok(await platformService.getOrganization(request.params.id)),
    });

    s.route({
      method: 'PATCH', url: '/organizations/:id',
      preHandler: [app.requirePlatformPermission('orgs.update')],
      schema: {
        tags: ['platform'], summary: 'Edit tenant account and owner profile', security, params: idParam,
        body: z.object({
          organizationName: z.string().trim().min(2).max(120).optional(),
          slug: z.string().trim().min(3).max(50).regex(/^[a-z0-9-]+$/).optional(),
          billingEmail: z.string().email().nullable().optional(),
          contactPhone: z.string().trim().min(3).max(30).nullable().optional(),
          ownerName: z.string().trim().min(2).max(80).optional(),
          ownerPhone: z.string().trim().min(3).max(30).optional(),
          ownerEmail: z.string().email().nullable().optional(),
          phoneCountry: countrySchema,
        }),
        response: { 200: okEnvelope, ...commonErrors },
      },
      handler: async (request) => {
        const body = request.body;
        const ownerPhone = body.ownerPhone !== undefined ? normalizePlatformPhone(body.ownerPhone, body.phoneCountry) : undefined;
        const contactPhone = body.contactPhone !== undefined && body.contactPhone !== null ? normalizePlatformPhone(body.contactPhone, body.phoneCountry) : body.contactPhone;
        return ok(await platformService.updateOrganization(request.params.id, {
          ...body,
          ownerPhone,
          contactPhone,
        }, request.platformAuth!.admin, { ip: request.ip, userAgent: request.headers['user-agent'] }));
      },
    });

    s.route({
      method: 'PATCH', url: '/organizations/:id/status',
      preHandler: [app.requirePlatformPermission('orgs.suspend')],
      schema: { tags: ['platform'], summary: 'Suspend, reactivate or cancel a tenant', security, params: idParam, body: z.object({ status: statusEnum, reason: z.string().trim().max(500).optional() }), response: { 200: okEnvelope, ...commonErrors } },
      handler: async (request) => ok((await platformService.setOrganizationStatus(request.params.id, request.body.status as OrgStatus, request.platformAuth!.admin, request.body.reason, { ip: request.ip, userAgent: request.headers['user-agent'] })).toJSON()),
    });

    s.route({
      method: 'PATCH', url: '/organizations/:id/plan',
      preHandler: [app.requirePlatformPermission('orgs.plan')],
      schema: { tags: ['platform'], summary: 'Change a tenant’s plan and limits', security, params: idParam, body: z.object({ plan: planKeySchema }), response: { 200: okEnvelope, ...commonErrors } },
      handler: async (request) => {
        const before = await Organization.findById(request.params.id).lean();
        if (!before) throw AppError.notFound('Organization not found');
        const organization = await organizationService.changePlan(before._id, request.body.plan);
        await recordPlatformAction({ action: 'org_plan_changed', organization, admin: request.platformAuth!.admin, before: { plan: before.plan }, after: { plan: organization.plan }, ip: request.ip, userAgent: request.headers['user-agent'] });
        return ok(organization.toJSON());
      },
    });

    s.route({
      method: 'PATCH', url: '/organizations/:id/notes',
      preHandler: [app.requirePlatformPermission('orgs.update')],
      schema: { tags: ['platform'], summary: 'Update internal account notes (never visible to the tenant)', security, params: idParam, body: z.object({ internalNotes: z.string().trim().max(5000) }), response: { 200: okEnvelope, ...commonErrors } },
      handler: async (request) => {
        const organization = await Organization.findByIdAndUpdate(request.params.id, { internalNotes: request.body.internalNotes }, { new: true });
        if (!organization) throw AppError.notFound('Organization not found');
        return ok(organization.toJSON());
      },
    });

    s.route({
      method: 'GET', url: '/organizations/:id/users',
      preHandler: [app.requirePlatformPermission('users.view')],
      schema: { tags: ['platform'], summary: 'List one tenant’s users', security, params: idParam, querystring: paginationQuery, response: { 200: listEnvelope, ...commonErrors } },
      handler: async (request) => {
        const { data, total, page, limit } = await platformService.listOrganizationUsers(request.params.id, request.query.page, request.query.limit);
        return paginated(data, total, page, limit);
      },
    });

    s.route({
      method: 'PATCH', url: '/organizations/:id/users/:userId/active',
      preHandler: [app.requirePlatformPermission('users.deactivate')],
      schema: { tags: ['platform'], summary: 'Activate or deactivate a tenant user', security, params: z.object({ id: objectIdSchema, userId: objectIdSchema }), body: z.object({ isActive: z.boolean() }), response: { 200: okEnvelope, ...commonErrors } },
      handler: async (request) => ok((await platformService.setUserActive(request.params.id, request.params.userId, request.body.isActive, request.platformAuth!.admin, { ip: request.ip, userAgent: request.headers['user-agent'] })).toJSON()),
    });

    s.route({
      method: 'PATCH', url: '/organizations/:id/users/:userId',
      preHandler: [app.requirePlatformPermission('users.update')],
      schema: {
        tags: ['platform'], summary: 'Edit tenant user profile', security,
        params: z.object({ id: objectIdSchema, userId: objectIdSchema }),
        body: z.object({ name: z.string().trim().min(2).max(80).optional(), phone: z.string().trim().min(3).max(30).optional(), email: z.string().email().nullable().optional(), designation: z.string().trim().max(120).nullable().optional(), role: z.enum(Object.values(ROLES) as [string, ...string[]]).optional(), phoneCountry: countrySchema, password: z.string().min(8).optional() }),
        response: { 200: okEnvelope, ...commonErrors },
      },
      handler: async (request) => {
        const body = request.body;
        const phone = body.phone !== undefined ? normalizePlatformPhone(body.phone, body.phoneCountry) : undefined;
        return ok((await platformService.updateOrganizationUser(request.params.id, request.params.userId, { ...body, phone }, request.platformAuth!.admin, { ip: request.ip, userAgent: request.headers['user-agent'] })).toJSON());
      },
    });

    s.route({
      method: 'GET', url: '/audit',
      preHandler: [app.requirePlatformPermission('audit.view')],
      schema: { tags: ['platform'], summary: 'Control-plane audit trail', security, querystring: paginationQuery.extend({ organizationId: objectIdSchema.optional() }), response: { 200: listEnvelope, ...commonErrors } },
      handler: async (request) => paginated(...await Promise.resolve(platformService.auditLog(request.query))),
    });
  });
}
