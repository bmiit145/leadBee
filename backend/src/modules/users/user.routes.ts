import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Types } from 'mongoose';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { User, type IUser } from '../../models/User.js';
import { Role } from '../../models/Role.js';
import { Organization } from '../../models/Organization.js';
import { organizationService } from '../organizations/organization.service.js';
import { userPolicy, type UserManager } from './user.service.js';
import { auditService } from '../audit/audit.service.js';
import { changedFields } from '../../lib/changedFields.js';
import { viewerOf } from '../../lib/viewer.js';
import { AppError } from '../../lib/errors.js';
import { mobilePhoneSchema } from '../../lib/phone.js';
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
import { AUDIT_ACTIONS, PERMISSIONS, ROLES, ROLE_ORDER } from '../../config/constants.js';
import { requireOrganizationId } from '../../lib/tenantContext.js';

const security = [{ tenantToken: [] }];

const createUserBody = z.object({
  name: z.string().trim().min(2).max(80),
  phone: mobilePhoneSchema,
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

/** The caller, in the shape the management policy reasons about. */
function managerOf(request: FastifyRequest): UserManager {
  const auth = request.auth;
  if (!auth) throw AppError.unauthorized();
  return { userId: auth.userId.toString(), role: auth.role, permissions: auth.permissions };
}

/** Where a request came from, for the audit trail. */
function originOf(request: FastifyRequest): { ip: string; userAgent?: string } {
  return { ip: request.ip, userAgent: request.headers['user-agent'] };
}

/**
 * What the audit trail tracks about a user: identity and access. Never the
 * password or session tokens — they are not read here and must not be added.
 */
function auditView(user: IUser): Record<string, unknown> {
  return {
    name: user.name,
    phone: user.phone,
    email: user.email ?? null,
    designation: user.designation ?? null,
    role: user.role,
    roleId: user.roleId?.toString() ?? null,
    permissions: [...user.permissions],
  };
}

/**
 * The role document a user's permissions resolve from at sign-in.
 *
 * A named custom role must exist in this tenant (the plugin scopes the lookup,
 * so another tenant's id is simply not found) and may grant nothing the caller
 * lacks. Otherwise it is the built-in role matching `role` — which is also what
 * a role change re-points to, so `role` and `roleId` cannot drift apart.
 */
async function roleIdFor(
  actor: UserManager,
  role: string,
  customRoleId?: string
): Promise<Types.ObjectId | undefined> {
  if (customRoleId) {
    const custom = await Role.findById(customRoleId).select('permissions').lean();
    if (!custom) throw AppError.badRequest('Role not found');
    userPolicy.assertCanGrant(actor, custom.permissions);
    return custom._id;
  }
  const builtIn = await Role.findOne({ name: role }).select('_id').lean();
  return builtIn?._id;
}

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
          .select('name phone email role designation avatarUrl isActive lastLoginAt createdAt')
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
      description:
        'The new user’s role may not rank above the caller’s, and any custom role ' +
        'or extra permissions must be ones the caller already holds.',
      security,
      body: createUserBody,
      response: { 201: okEnvelope, ...commonErrors, 402: commonErrors[400] },
    },
    handler: async (request, reply) => {
      const actor = managerOf(request);
      const body = request.body;

      userPolicy.assertCanAssignRole(actor, body.role);
      if (body.permissions) userPolicy.assertCanGrant(actor, body.permissions);

      const organizationId = requireOrganizationId();
      const organization = request.auth!.organization;
      await organizationService.assertCanAddUser(organization);

      const roleId = await roleIdFor(actor, body.role, body.roleId);

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

      await auditService.record({
        action: AUDIT_ACTIONS.USER_CREATED,
        entityType: 'user',
        entityId: user._id,
        actor: viewerOf(request),
        after: auditView(user),
        origin: originOf(request),
      });

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
      description:
        'Changing `role` without naming a custom `roleId` re-points the user’s ' +
        'permissions at that role’s built-in set. Nobody may change their own ' +
        'role or permissions here.',
      security,
      params: idParam,
      body: updateUserBody,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const actor = managerOf(request);
      const user = await User.findById(request.params.id);
      if (!user) throw AppError.notFound('User not found');

      userPolicy.assertCanManage(actor, { role: user.role });
      const before = auditView(user);

      const body = request.body;
      const changesAccess =
        body.role !== undefined || body.roleId !== undefined || body.permissions !== undefined;
      if (changesAccess) {
        userPolicy.assertNotSelf(actor, user._id.toString(), 'change the role or permissions of');
      }
      if (body.role !== undefined) userPolicy.assertCanAssignRole(actor, body.role);
      if (body.permissions !== undefined) userPolicy.assertCanGrant(actor, body.permissions);

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
      if (body.role !== undefined || body.roleId !== undefined) {
        // Resolved before `role` is overwritten: a role change that left roleId
        // on the old role would keep the old permissions while `isOrganizer`
        // followed the new role string.
        user.roleId = await roleIdFor(actor, body.role ?? user.role, body.roleId ?? undefined);
      }
      if (body.role !== undefined) user.role = body.role as typeof user.role;
      if (body.permissions !== undefined) user.permissions = body.permissions;
      if (body.designation !== undefined) user.designation = body.designation;
      if (body.avatarUrl !== undefined) user.avatarUrl = body.avatarUrl;

      await user.save();

      // A save that changed nothing the trail tracks leaves no entry.
      const diff = changedFields(before, auditView(user));
      if (diff) {
        await auditService.record({
          action: AUDIT_ACTIONS.USER_UPDATED,
          entityType: 'user',
          entityId: user._id,
          actor: viewerOf(request),
          ...diff,
          origin: originOf(request),
        });
      }

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
        'rather than when the access token happens to expire. Reactivating ' +
        'takes a seat, so it is refused when the plan is full.',
      security,
      params: idParam,
      body: z.object({ isActive: z.boolean() }),
      response: { 200: okEnvelope, ...commonErrors, 402: commonErrors[400] },
    },
    handler: async (request) => {
      const actor = managerOf(request);
      const user = await User.findById(request.params.id).select('+refreshTokens');
      if (!user) throw AppError.notFound('User not found');

      userPolicy.assertCanManage(actor, { role: user.role });

      const { isActive } = request.body;
      // A repeat of the current state is a no-op. Without this, sending
      // `isActive: true` twice counted the same seat twice.
      if (user.isActive === isActive) return ok(user.toJSON());

      if (!isActive && user._id.equals(request.auth!.userId)) {
        throw AppError.badRequest('You cannot deactivate your own account');
      }

      if (!isActive && user.role === ROLES.OWNER) {
        const owners = await User.countDocuments({ role: ROLES.OWNER, isActive: true });
        if (owners <= 1) {
          throw AppError.conflict('This is the only active owner.');
        }
      }

      if (isActive) await organizationService.assertCanAddUser(request.auth!.organization);

      user.isActive = isActive;
      if (!isActive) user.refreshTokens = [];
      await user.save();

      await Organization.updateOne(
        { _id: requireOrganizationId() },
        { $inc: { 'usage.users': isActive ? 1 : -1 } }
      );

      await auditService.record({
        action: isActive ? AUDIT_ACTIONS.USER_ACTIVATED : AUDIT_ACTIONS.USER_DEACTIVATED,
        entityType: 'user',
        entityId: user._id,
        actor: viewerOf(request),
        before: { isActive: !isActive },
        after: { isActive },
        origin: originOf(request),
      });

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
      description:
        'Not for your own account — use /auth/change-password, which asks for ' +
        'the current password first.',
      security,
      params: idParam,
      body: z.object({ newPassword: z.string().min(6) }),
      response: { 200: messageEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const actor = managerOf(request);
      userPolicy.assertNotSelf(actor, request.params.id, 'reset the password of');

      const user = await User.findById(request.params.id).select('+password +refreshTokens');
      if (!user) throw AppError.notFound('User not found');

      userPolicy.assertCanManage(actor, { role: user.role });

      user.password = request.body.newPassword;
      user.refreshTokens = [];
      await user.save();

      // That it happened, and who did it — never the value.
      await auditService.record({
        action: AUDIT_ACTIONS.USER_PASSWORD_RESET,
        entityType: 'user',
        entityId: user._id,
        actor: viewerOf(request),
        origin: originOf(request),
      });

      return message('Password reset. The user must sign in again.');
    },
  });
}
