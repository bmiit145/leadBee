import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { User } from '../../models/User.js';
import { Role } from '../../models/Role.js';
import { Organization } from '../../models/Organization.js';
import { organizationService } from '../organizations/organization.service.js';
import { AppError } from '../../lib/errors.js';
import { pageParams } from '../../lib/pagination.js';
import {
  booleanQuery,
  commonErrors,
  idParam,
  listEnvelope,
  messageEnvelope,
  objectIdSchema,
  okEnvelope,
  paginationQuery,
} from '../../lib/schemas.js';
import { message, ok, paginated } from '../../lib/response.js';
import { PERMISSIONS, ROLES, ROLE_ORDER } from '../../config/constants.js';
import { requireOrganizationId } from '../../lib/tenantContext.js';

const security = [{ tenantToken: [] }];

const createUserBody = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(6).max(20),
  email: z.string().email().optional(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(ROLE_ORDER as [string, ...string[]]).default(ROLES.USER),
  roleId: objectIdSchema.optional(),
  permissions: z.array(z.string()).optional(),
  designation: z.string().trim().optional(),
});

const updateUserBody = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  email: z.string().email().optional().or(z.literal('')),
  role: z.enum(ROLE_ORDER as [string, ...string[]]).optional(),
  roleId: objectIdSchema.nullable().optional(),
  permissions: z.array(z.string()).optional(),
  designation: z.string().trim().optional(),
  avatarUrl: z.string().trim().optional(),
});

export async function userRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('preHandler', app.authenticateTenant);

  r.route({
    method: 'GET',
    url: '/',
    schema: {
      tags: ['users'],
      summary: 'List users in the organization',
      description:
        'Available to every signed-in user — assignment pickers and member ' +
        'avatars need it. Only names, roles and avatars are returned.',
      security,
      querystring: paginationQuery.extend({
        search: z.string().trim().optional(),
        isActive: booleanQuery.optional(),
        role: z.enum(ROLE_ORDER as [string, ...string[]]).optional(),
      }),
      response: { 200: listEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const { search, isActive, role } = request.query;
      const filter: Record<string, unknown> = {};
      if (isActive !== undefined) filter.isActive = isActive;
      else filter.isActive = true;
      if (role) filter.role = role;
      if (search) {
        const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filter.$or = [{ name: regex }, { phone: regex }, { email: regex }];
      }

      const { page, limit, skip } = pageParams(request.query);
      const [data, total] = await Promise.all([
        User.find(filter)
          .select('name phone email role designation avatarUrl isActive lastLoginAt')
          .populate('roleId', 'name')
          .sort({ name: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        User.countDocuments(filter),
      ]);

      return paginated(data, total, page, limit);
    },
  });

  r.route({
    method: 'POST',
    url: '/',
    preHandler: [app.requirePermission(PERMISSIONS.USERS_MANAGE)],
    schema: {
      tags: ['users'],
      summary: 'Add a user to the organization',
      security,
      body: createUserBody,
      response: { 201: okEnvelope, ...commonErrors, 402: commonErrors[400] },
    },
    handler: async (request, reply) => {
      const organizationId = requireOrganizationId();
      const organization = request.auth!.organization;
      await organizationService.assertCanAddUser(organization);

      const body = request.body;

      // Fall back to the built-in role document when the caller did not name a
      // custom one, so permissions resolve without a special case at auth time.
      let roleId = body.roleId ? (body.roleId as string) : undefined;
      if (!roleId) {
        const builtIn = await Role.findOne({ name: body.role }).select('_id').lean();
        roleId = builtIn?._id.toString();
      }

      const user = await User.create({
        organizationId,
        name: body.name,
        phone: body.phone,
        email: body.email,
        password: body.password,
        role: body.role,
        roleId,
        permissions: body.permissions ?? [],
        designation: body.designation,
      });

      await Organization.updateOne({ _id: organizationId }, { $inc: { 'usage.users': 1 } });

      return reply.status(201).send(ok(user.toJSON()));
    },
  });

  r.route({
    method: 'GET',
    url: '/:id',
    schema: {
      tags: ['users'],
      summary: 'Get one user',
      security,
      params: idParam,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const user = await User.findById(request.params.id).populate('roleId', 'name permissions');
      if (!user) throw AppError.notFound('User not found');
      return ok(user.toJSON());
    },
  });

  r.route({
    method: 'PUT',
    url: '/:id',
    preHandler: [app.requirePermission(PERMISSIONS.USERS_MANAGE)],
    schema: {
      tags: ['users'],
      summary: 'Update a user',
      security,
      params: idParam,
      body: updateUserBody,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const user = await User.findById(request.params.id);
      if (!user) throw AppError.notFound('User not found');

      const body = request.body;

      // The last owner must stay an owner, or the organization locks itself out
      // of its own user management.
      if (body.role && user.role === ROLES.OWNER && body.role !== ROLES.OWNER) {
        const owners = await User.countDocuments({ role: ROLES.OWNER, isActive: true });
        if (owners <= 1) {
          throw AppError.conflict(
            'This is the only owner. Promote another user to owner first.'
          );
        }
      }

      if (body.name !== undefined) user.name = body.name;
      if (body.email !== undefined) user.email = body.email || undefined;
      if (body.role !== undefined) user.role = body.role as typeof user.role;
      if (body.roleId !== undefined) {
        user.roleId = body.roleId ? (body.roleId as unknown as typeof user.roleId) : undefined;
      }
      if (body.permissions !== undefined) user.permissions = body.permissions;
      if (body.designation !== undefined) user.designation = body.designation;
      if (body.avatarUrl !== undefined) user.avatarUrl = body.avatarUrl;

      await user.save();
      return ok(user.toJSON());
    },
  });

  r.route({
    method: 'PATCH',
    url: '/:id/active',
    preHandler: [app.requirePermission(PERMISSIONS.USERS_MANAGE)],
    schema: {
      tags: ['users'],
      summary: 'Activate or deactivate a user',
      description:
        'Deactivating also revokes every session, so access ends immediately ' +
        'rather than when the access token happens to expire.',
      security,
      params: idParam,
      body: z.object({ isActive: z.boolean() }),
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const user = await User.findById(request.params.id).select('+refreshTokens');
      if (!user) throw AppError.notFound('User not found');

      if (user._id.equals(request.auth!.userId) && !request.body.isActive) {
        throw AppError.badRequest('You cannot deactivate your own account');
      }

      if (!request.body.isActive && user.role === ROLES.OWNER) {
        const owners = await User.countDocuments({ role: ROLES.OWNER, isActive: true });
        if (owners <= 1) {
          throw AppError.conflict('This is the only active owner.');
        }
      }

      user.isActive = request.body.isActive;
      if (!request.body.isActive) user.refreshTokens = [];
      await user.save();

      await Organization.updateOne(
        { _id: requireOrganizationId() },
        { $inc: { 'usage.users': request.body.isActive ? 1 : -1 } }
      );

      return ok(user.toJSON());
    },
  });

  r.route({
    method: 'POST',
    url: '/:id/reset-password',
    preHandler: [app.requirePermission(PERMISSIONS.USERS_MANAGE)],
    schema: {
      tags: ['users'],
      summary: 'Set a new password for a user (revokes their sessions)',
      security,
      params: idParam,
      body: z.object({ newPassword: z.string().min(6) }),
      response: { 200: messageEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const user = await User.findById(request.params.id).select('+password +refreshTokens');
      if (!user) throw AppError.notFound('User not found');

      user.password = request.body.newPassword;
      user.refreshTokens = [];
      await user.save();
      return message('Password reset. The user must sign in again.');
    },
  });
}
