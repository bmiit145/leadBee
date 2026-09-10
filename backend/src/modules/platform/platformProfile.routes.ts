import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { mobilePhoneSchema, contactPhoneSchema } from '../../lib/phone.js';
import { objectIdSchema, okEnvelope, commonErrors } from '../../lib/schemas.js';
import { ok } from '../../lib/response.js';
import { ROLES, type Role } from '../../config/constants.js';
import { updateOrganizationProfile, updateOrganizationUser } from './platformProfile.service.js';

const security = [{ platformToken: [] }];
const roleSchema = z.enum(Object.values(ROLES) as [Role, ...Role[]]);

export async function platformProfileRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (secured) => {
    const s = secured.withTypeProvider<ZodTypeProvider>();
    s.addHook('preHandler', app.authenticatePlatform);

    s.route({
      method: 'PATCH',
      url: '/organizations/:id',
      preHandler: [app.requirePlatformPermission('orgs.update')],
      schema: {
        tags: ['platform'],
        summary: 'Edit tenant account and owner profile',
        security,
        params: z.object({ id: objectIdSchema }),
        body: z.object({
          organizationName: z.string().trim().min(2).max(120).optional(),
          slug: z.string().trim().min(3).max(50).regex(/^[a-z0-9-]+$/).optional(),
          billingEmail: z.string().email().nullable().optional(),
          contactPhone: contactPhoneSchema.nullable().optional(),
          ownerName: z.string().trim().min(2).max(80).optional(),
          ownerPhone: mobilePhoneSchema.optional(),
          ownerEmail: z.string().email().nullable().optional(),
        }),
        response: { 200: okEnvelope, ...commonErrors },
      },
      handler: async (request) => {
        const updated = await updateOrganizationProfile(
          request.params.id,
          request.body,
          request.platformAuth!.admin,
          { ip: request.ip, userAgent: request.headers['user-agent'] }
        );
        return ok(updated);
      },
    });

    s.route({
      method: 'PATCH',
      url: '/organizations/:id/users/:userId',
      preHandler: [app.requirePlatformPermission('users.update')],
      schema: {
        tags: ['platform'],
        summary: 'Edit a tenant user profile',
        security,
        params: z.object({ id: objectIdSchema, userId: objectIdSchema }),
        body: z.object({
          name: z.string().trim().min(2).max(80).optional(),
          phone: mobilePhoneSchema.optional(),
          email: z.string().email().nullable().optional(),
          designation: z.string().trim().max(120).nullable().optional(),
          role: roleSchema.optional(),
          password: z.string().min(8).optional(),
        }),
        response: { 200: okEnvelope, ...commonErrors },
      },
      handler: async (request) => {
        const updated = await updateOrganizationUser(
          request.params.id,
          request.params.userId,
          request.body,
          request.platformAuth!.admin,
          { ip: request.ip, userAgent: request.headers['user-agent'] }
        );
        return ok(updated.toJSON());
      },
    });
  });
}
