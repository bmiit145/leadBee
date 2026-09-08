import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { Role } from '../../models/Role.js';
import { User } from '../../models/User.js';
import { AppError } from '../../lib/errors.js';
import {
  commonErrors,
  idParam,
  messageEnvelope,
  okEnvelope,
} from '../../lib/schemas.js';
import { message, ok } from '../../lib/response.js';
import { PERMISSIONS } from '../../config/constants.js';

const security = [{ tenantToken: [] }];

const roleBody = z.object({
  name: z.string().trim().min(2).max(50),
  description: z.string().trim().optional(),
  permissions: z.array(z.string()),
});

export async function roleRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('preHandler', app.authenticateTenant);

  r.route({
    method: 'GET',
    url: '/',
    schema: {
      tags: ['users'],
      summary: 'List roles defined in this organization',
      security,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async () => ok(await Role.find().sort({ isSystem: -1, name: 1 }).lean()),
  });

  r.route({
    method: 'GET',
    url: '/permissions',
    schema: {
      tags: ['users'],
      summary: 'Every permission string the API recognises',
      description: 'Drives the checkbox list in the role editor.',
      security,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async () =>
      ok(
        Object.values(PERMISSIONS).map((value) => ({
          value,
          group: value === '*' ? 'all' : value.split('.')[0],
        }))
      ),
  });

  r.route({
    method: 'POST',
    url: '/',
    preHandler: [app.requirePermission(PERMISSIONS.ROLES_MANAGE)],
    schema: {
      tags: ['users'],
      summary: 'Create a custom role',
      security,
      body: roleBody,
      response: { 201: okEnvelope, ...commonErrors },
    },
    handler: async (request, reply) => {
      const role = await Role.create({ ...request.body, isSystem: false });
      return reply.status(201).send(ok(role));
    },
  });

  r.route({
    method: 'PUT',
    url: '/:id',
    preHandler: [app.requirePermission(PERMISSIONS.ROLES_MANAGE)],
    schema: {
      tags: ['users'],
      summary: 'Update a role’s permissions',
      security,
      params: idParam,
      body: roleBody.partial(),
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const role = await Role.findById(request.params.id);
      if (!role) throw AppError.notFound('Role not found');

      // Built-in roles may have their permissions tuned but not be renamed —
      // the name is what `User.role` and the auth fallback resolve against.
      if (role.isSystem && request.body.name && request.body.name !== role.name) {
        throw AppError.badRequest('Built-in roles cannot be renamed');
      }

      Object.assign(role, request.body);
      await role.save();
      return ok(role);
    },
  });

  r.route({
    method: 'DELETE',
    url: '/:id',
    preHandler: [app.requirePermission(PERMISSIONS.ROLES_MANAGE)],
    schema: {
      tags: ['users'],
      summary: 'Delete a custom role',
      security,
      params: idParam,
      response: { 200: messageEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const role = await Role.findById(request.params.id);
      if (!role) throw AppError.notFound('Role not found');
      if (role.isSystem) throw AppError.badRequest('Built-in roles cannot be deleted');

      // Deleting a role out from under its users would silently strip their
      // permissions on next sign-in.
      const inUse = await User.countDocuments({ roleId: role._id });
      if (inUse > 0) {
        throw AppError.conflict(
          `${inUse} user${inUse === 1 ? '' : 's'} still have this role. Reassign them first.`,
          { users: inUse }
        );
      }

      await role.deleteOne();
      return message('Role deleted');
    },
  });
}
