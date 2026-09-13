import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Types } from 'mongoose';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { User, type IUser } from '../../models/User.js';
import { Role } from '../../models/Role.js';
import { Organization } from '../../models/Organization.js';
import { organizationService } from '../organizations/organization.service.js';
import { userPolicy, type UserManager } from './user.service.js';
import { memberService } from './member.service.js';
import { identityService } from '../accounts/identity.service.js';
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
import {
  AUDIT_ACTIONS,
  PERMISSIONS,
  ROLES,
  ROLE_ORDER,
  type Role as RoleName,
} from '../../config/constants.js';
import { requireOrganizationId } from '../../lib/tenantContext.js';

const security = [{ tenantToken: [] }];

const emailSchema = z.string().trim().toLowerCase().email('A valid email is required').max(254);
const passwordSchema = z.string().min(8, 'Password must be at least 8 characters').max(128);

const createUserBody = z.object({
  name: z.string().trim().min(2).max(80),
  phone: mobilePhoneSchema,
  // Required: with sign-in by email or mobile, an email is half of who a person is.
  email: emailSchema,
  // Only used when the person is new to LeadBee. See memberService.addMember.
  password: passwordSchema.optional(),
  role: z.enum(ROLE_ORDER as [string, ...string[]]).default(ROLES.USER),
  roleId: objectIdSchema.optional(),
  permissions: z.array(z.string()).optional(),
  designation: z.string().trim().optional(),
});

const updateUserBody = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  email: emailSchema.optional(),
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
      summary: 'Add a person to the organization',
      description:
        'If the email and mobile already belong to someone on LeadBee, their ' +
        'existing account is linked — they keep their own password — and the ' +
        'response carries `linkedExistingAccount: true`. An email or mobile tied ' +
        'to a different person answers 409. The role may not rank above the ' +
        'caller’s, and any custom role or extra permissions must be ones the ' +
        'caller already holds.',
      security,
      body: createUserBody,
      response: { 201: okEnvelope, ...commonErrors, 402: commonErrors[400], 409: commonErrors[400] },
    },
    handler: async (request, reply) => {
      const actor = managerOf(request);
      const body = request.body;

      userPolicy.assertCanAssignRole(actor, body.role);
      if (body.permissions) userPolicy.assertCanGrant(actor, body.permissions);

      const organizationId = requireOrganizationId();
      await organizationService.assertCanAddUser(request.auth!.organization);

      const roleId = await roleIdFor(actor, body.role, body.roleId);

      const { user, linkedExistingAccount } = await memberService.addMember(organizationId, {
        name: body.name,
        email: body.email,
        phone: body.phone,
        password: body.password,
        role: body.role as RoleName,
        roleId,
        permissions: body.permissions,
        designation: body.designation,
      });

      await Organization.updateOne({ _id: organizationId }, { $inc: { 'usage.users': 1 } });

      await auditService.record({
        action: AUDIT_ACTIONS.USER_CREATED,
        entityType: 'user',
        entityId: user._id,
        actor: viewerOf(request),
        after: { ...auditView(user), linkedExistingAccount },
        origin: originOf(request),
      });

      return reply.status(201).send(ok({ ...user.toJSON(), linkedExistingAccount }));
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
        'Name and email belong to the person’s account, so they can be changed ' +
        'here only when this organization is the only one the person belongs to ' +
        '(409 otherwise). Changing `role` without naming a custom `roleId` ' +
        're-points the user’s permissions at that role’s built-in set. Nobody ' +
        'may change their own role or permissions here.',
      security,
      params: idParam,
      body: updateUserBody,
      response: { 200: okEnvelope, ...commonErrors, 409: commonErrors[400] },
    },
    handler: async (request) => {
      const actor = managerOf(request);
      const existing = await User.findById(request.params.id);
      if (!existing) throw AppError.notFound('User not found');

      userPolicy.assertCanManage(actor, { role: existing.role });
      const before = auditView(existing);

      const body = request.body;
      const changesAccess =
        body.role !== undefined || body.roleId !== undefined || body.permissions !== undefined;
      if (changesAccess) {
        userPolicy.assertNotSelf(actor, existing._id.toString(), 'change the role or permissions of');
      }
      if (body.role !== undefined) userPolicy.assertCanAssignRole(actor, body.role);
      if (body.permissions !== undefined) userPolicy.assertCanGrant(actor, body.permissions);

      // The last owner must stay an owner, or the organization locks itself out
      // of its own user management.
      if (body.role && existing.role === ROLES.OWNER && body.role !== ROLES.OWNER) {
        const owners = await User.countDocuments({ role: ROLES.OWNER, isActive: true });
        if (owners <= 1) {
          throw AppError.conflict(
            'This is the only owner. Promote another user to owner first.'
          );
        }
      }

      // Resolved before anything is written, so a bad custom role cannot leave a
      // name change saved and a role change refused. Resolved before `role` is
      // overwritten too: a role change that left roleId on the old role would
      // keep the old permissions while `isOrganizer` followed the new role string.
      const nextRoleId =
        body.role !== undefined || body.roleId !== undefined
          ? await roleIdFor(actor, body.role ?? existing.role, body.roleId ?? undefined)
          : undefined;

      const changesIdentity =
        (body.name !== undefined && body.name !== existing.name) ||
        (body.email !== undefined && body.email !== existing.email);
      if (changesIdentity) {
        await identityService.assertSoleMembership(
          existing.accountId,
          requireOrganizationId(),
          'change their name or email'
        );
        await identityService.updateIdentity(existing.accountId, {
          name: body.name,
          email: body.email,
        });
      }

      // Re-read after an identity change: it rewrote this membership's copy.
      const user = changesIdentity ? await User.findById(existing._id) : existing;
      if (!user) throw AppError.notFound('User not found');

      if (body.role !== undefined || body.roleId !== undefined) user.roleId = nextRoleId;
      if (body.role !== undefined) user.role = body.role as RoleName;
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
        'Membership only — the person’s account and their other organizations ' +
        'are untouched. Deactivating also revokes this membership’s sessions, so ' +
        'access ends immediately rather than when the access token happens to ' +
        'expire. Reactivating takes a seat, so it is refused when the plan is full.',
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
        'The password belongs to the person’s account, so this is refused (409) ' +
        'when they also belong to another organization. Not for your own account ' +
        '— use /auth/change-password, which asks for the current password first.',
      security,
      params: idParam,
      body: z.object({ newPassword: passwordSchema }),
      response: { 200: messageEnvelope, ...commonErrors, 409: commonErrors[400] },
    },
    handler: async (request) => {
      const actor = managerOf(request);
      userPolicy.assertNotSelf(actor, request.params.id, 'reset the password of');

      const user = await User.findById(request.params.id);
      if (!user) throw AppError.notFound('User not found');

      userPolicy.assertCanManage(actor, { role: user.role });

      await identityService.assertSoleMembership(
        user.accountId,
        requireOrganizationId(),
        'reset their password'
      );
      await identityService.setPassword(user.accountId, request.body.newPassword);

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
