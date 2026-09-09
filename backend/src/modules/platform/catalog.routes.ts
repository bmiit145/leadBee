import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { catalogService } from './catalog.service.js';
import { commonErrors, idParam, okEnvelope } from '../../lib/schemas.js';
import { ok } from '../../lib/response.js';
import { PLAN_STATUSES, type PlanStatus } from '../../models/Plan.js';

const security = [{ platformToken: [] }];

const keySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Invalid key');

const featureKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9_.-]*$/, 'Invalid feature key');

/**
 * A grant, as the plan builder submits it.
 *
 * `limit: -1` is unlimited. `null` means "nothing to say", which is different
 * from zero and is why the field is nullable rather than defaulted.
 */
const grantSchema = z.object({
  featureKey: featureKeySchema,
  enabled: z.boolean(),
  limit: z.number().int().min(-1).nullable().optional(),
  config: z.record(z.unknown()).nullable().optional(),
});

const planBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  status: z.enum(Object.values(PLAN_STATUSES) as [string, ...string[]]).optional(),
  isPublic: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  trialDays: z.number().int().min(0).max(365).optional(),
  grants: z.array(grantSchema).max(500),
});

/**
 * Catalogue administration.
 *
 * Mounted under the platform realm, so every route here already requires a
 * platform token — a tenant token cannot reach the catalogue at all.
 */
export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Authenticate every route in this plugin.
   *
   * Required, and easy to miss: this is a *separate* plugin from
   * `platform.routes.ts`, so it does not inherit that file's nested
   * authenticated scope even though both mount under `/platform`. Without this
   * hook `request.platformAuth` is never set, and `requirePlatformPermission`
   * rejects every request with a bare "Authentication required" — which reads
   * like a bad token rather than a missing hook.
   *
   * Fastify encapsulation means this applies to the routes below and nothing
   * else. See backend/RULES.md BE-11.
   */
  app.addHook('preHandler', app.authenticatePlatform);

  r.route({
    method: 'GET',
    url: '/catalog',
    preHandler: [app.requirePlatformPermission('orgs.view')],
    schema: {
      tags: ['platform'],
      summary: 'Modules and their features — the plan builder’s source',
      description:
        'Data-driven: a module shipped in a new release registers itself at boot ' +
        'and appears here, so the plan builder gains its checkboxes with no ' +
        'frontend deploy.',
      security,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async () => ok(await catalogService.catalog()),
  });

  // ─── Plans ──────────────────────────────────────────────────────────────────

  r.route({
    method: 'GET',
    url: '/plans',
    preHandler: [app.requirePlatformPermission('orgs.view')],
    schema: {
      tags: ['platform'],
      summary: 'List plans',
      security,
      querystring: z.object({
        allVersions: z.coerce.boolean().optional(),
      }),
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) =>
      ok(await catalogService.listPlans(request.query.allVersions ?? false)),
  });

  r.route({
    method: 'GET',
    url: '/plans/:key',
    preHandler: [app.requirePlatformPermission('orgs.view')],
    schema: {
      tags: ['platform'],
      summary: 'Read one plan, newest version by default',
      security,
      params: z.object({ key: keySchema }),
      querystring: z.object({ version: z.coerce.number().int().min(1).optional() }),
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const plan = await catalogService.getPlan(request.params.key, request.query.version);
      const usage = await catalogService.planUsage(request.params.key);
      return ok({ plan: plan.toJSON(), usage });
    },
  });

  r.route({
    method: 'POST',
    url: '/plans',
    preHandler: [app.requirePlatformPermission('orgs.plan')],
    schema: {
      tags: ['platform'],
      summary: 'Create a plan',
      security,
      body: planBodySchema.extend({ key: keySchema }),
      response: { 201: okEnvelope, ...commonErrors },
    },
    handler: async (request, reply) => {
      const plan = await catalogService.createPlan(
        { ...request.body, status: request.body.status as PlanStatus | undefined },
        request.platformAuth!.adminId
      );
      return reply.code(201).send(ok(plan.toJSON()));
    },
  });

  r.route({
    method: 'POST',
    url: '/plans/:key/revisions',
    preHandler: [app.requirePlatformPermission('orgs.plan')],
    schema: {
      tags: ['platform'],
      summary: 'Publish the next version of a plan',
      description:
        'Never mutates the current version. Tenants stay pinned to the version ' +
        'they were sold, so publishing cannot rewrite an active subscription.',
      security,
      params: z.object({ key: keySchema }),
      body: planBodySchema,
      response: { 201: okEnvelope, ...commonErrors },
    },
    handler: async (request, reply) => {
      const plan = await catalogService.publishRevision(
        request.params.key,
        { ...request.body, status: request.body.status as PlanStatus | undefined },
        request.platformAuth!.adminId
      );
      return reply.code(201).send(ok(plan.toJSON()));
    },
  });

  r.route({
    method: 'PATCH',
    url: '/plans/:key/versions/:version/status',
    preHandler: [app.requirePlatformPermission('orgs.plan')],
    schema: {
      tags: ['platform'],
      summary: 'Activate, grandfather or retire a plan version',
      security,
      params: z.object({ key: keySchema, version: z.coerce.number().int().min(1) }),
      body: z.object({
        status: z.enum(Object.values(PLAN_STATUSES) as [string, ...string[]]),
      }),
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const plan = await catalogService.setPlanStatus(
        request.params.key,
        request.params.version,
        request.body.status as PlanStatus
      );
      return ok(plan.toJSON());
    },
  });

  // ─── Add-ons ────────────────────────────────────────────────────────────────

  r.route({
    method: 'GET',
    url: '/addons',
    preHandler: [app.requirePlatformPermission('orgs.view')],
    schema: {
      tags: ['platform'],
      summary: 'List add-ons',
      security,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async () => ok(await catalogService.listAddOns()),
  });

  r.route({
    method: 'POST',
    url: '/addons',
    preHandler: [app.requirePlatformPermission('orgs.plan')],
    schema: {
      tags: ['platform'],
      summary: 'Create an add-on',
      security,
      body: z.object({
        key: keySchema,
        name: z.string().trim().min(1).max(80),
        description: z.string().trim().max(500).optional(),
        grants: z.array(grantSchema).max(500),
      }),
      response: { 201: okEnvelope, ...commonErrors },
    },
    handler: async (request, reply) => {
      const addOn = await catalogService.createAddOn(request.body);
      return reply.code(201).send(ok(addOn.toJSON()));
    },
  });

  // ─── Per-organization entitlements ──────────────────────────────────────────

  r.route({
    method: 'PATCH',
    url: '/organizations/:id/entitlements',
    preHandler: [app.requirePlatformPermission('orgs.plan')],
    schema: {
      tags: ['platform'],
      summary: 'Set a tenant’s add-ons and overrides',
      description:
        'The enterprise escape hatch: a negotiated deal is expressed as overrides ' +
        'rather than by minting a bespoke plan that must then be maintained.',
      security,
      params: idParam,
      body: z.object({
        addOnKeys: z.array(keySchema).max(50).optional(),
        overrides: z.array(grantSchema).max(500).optional(),
      }),
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const organization = await catalogService.setOrganizationEntitlements(
        request.params.id,
        request.body
      );
      return ok(organization.toJSON());
    },
  });

  r.route({
    method: 'POST',
    url: '/organizations/:id/entitlements/resync',
    preHandler: [app.requirePlatformPermission('orgs.plan')],
    schema: {
      tags: ['platform'],
      summary: 'Re-resolve entitlements against the pinned plan version',
      security,
      params: idParam,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => ok((await catalogService.resync(request.params.id)).toJSON()),
  });

  r.route({
    method: 'POST',
    url: '/organizations/:id/entitlements/migrate',
    preHandler: [app.requirePlatformPermission('orgs.plan')],
    schema: {
      tags: ['platform'],
      summary: 'Move a tenant onto a specific plan version',
      security,
      params: idParam,
      body: z.object({ version: z.number().int().min(1) }),
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) =>
      ok(
        (
          await catalogService.migrateToVersion(request.params.id, request.body.version)
        ).toJSON()
      ),
  });

}

