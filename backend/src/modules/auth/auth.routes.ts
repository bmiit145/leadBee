import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authService } from './auth.service.js';
import {
  changePasswordBody,
  loginBody,
  pushTokenBody,
  refreshBody,
  updateMeBody,
} from './auth.schema.js';
import {
  commonErrors,
  messageEnvelope,
  objectIdSchema,
  okEnvelope,
} from '../../lib/schemas.js';
import { message, ok } from '../../lib/response.js';
import { User } from '../../models/User.js';
import { Account } from '../../models/Account.js';
import { Project } from '../../models/Project.js';
import { AppError } from '../../lib/errors.js';
import { identityService } from '../accounts/identity.service.js';
import { membershipsService } from '../accounts/memberships.service.js';
import { accountOrganizationService } from '../accounts/accountOrganization.service.js';
import { createOrganizationBody } from '../accounts/organization.schema.js';
import type { LoginResult } from './auth.service.js';

/** The response body for any request that opens a membership session. */
function tenantSession(result: LoginResult) {
  return {
    session: 'tenant' as const,
    user: result.user.toJSON(),
    organization: result.organization.toJSON(),
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'POST',
    url: '/login',
    // Public by design (BE-11). Brute-force ceiling, keyed on IP because there
    // is no user yet.
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['auth'],
      summary: 'Sign in with email or mobile number and password',
      description:
        'Send `identifier` (email or mobile). Older app builds may send `phone`, ' +
        'which is still accepted. `data.session` says what was issued: `tenant` ' +
        '(user, organization and tenant tokens) or `account` (the person belongs ' +
        'to no organization yet — `account`, `organization: null` and account-realm ' +
        'tokens, refreshed at `/accounts/session/refresh`). If the account belongs ' +
        'to more than one organization, responds 409 with ' +
        '`error.details.organizations` — resubmit including `organizationId`. 403 ' +
        '`ACCOUNT_SUSPENDED` and `EMAIL_NOT_VERIFIED` are returned only after the ' +
        'password has been verified.',
      body: loginBody,
      response: { 200: okEnvelope, ...commonErrors, 409: commonErrors[400] },
    },
    handler: async (request, reply) => {
      const { identifier, phone, password, organizationId } = request.body;
      const signInWith = identifier ?? phone;
      if (!signInWith) throw AppError.badRequest('Enter your email or mobile number');

      const result = await authService.login(signInWith, password, organizationId);

      if ('needsOrgSelection' in result) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'ORGANIZATION_SELECTION_REQUIRED',
            message: 'This account belongs to more than one organization.',
            details: { organizations: result.organizations },
          },
          requestId: request.id,
        });
      }

      if ('accountSession' in result) {
        const { account, tokens } = result.accountSession;
        return reply.send(
          ok({
            session: 'account',
            account: account.toJSON(),
            organization: null,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
          })
        );
      }

      return reply.send(
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
    url: '/refresh',
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['auth'],
      summary: 'Exchange a refresh token for a new pair',
      body: refreshBody,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const result = await authService.refresh(request.body.refreshToken);
      return ok({
        user: result.user.toJSON(),
        organization: result.organization.toJSON(),
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
      });
    },
  });

  r.route({
    method: 'GET',
    url: '/me',
    preHandler: [app.authenticateTenant],
    schema: {
      tags: ['auth'],
      summary: 'The signed-in user, their organization and effective permissions',
      security: [{ tenantToken: [] }],
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const auth = request.auth!;
      // The client renders the project picker straight off this, so the refs
      // are populated here rather than making the app fetch them separately.
      await auth.user.populate([
        { path: 'projects', select: 'name color' },
        { path: 'defaultProject', select: 'name color' },
        { path: 'roleId', select: 'name permissions' },
      ]);
      return ok({
        user: { ...auth.user.toJSON(), permissions: auth.permissions },
        organization: auth.organization.toJSON(),
        isOrganizer: auth.isOrganizer,
      });
    },
  });

  // ─── The organizations this person belongs to (ADR-0004) ─────────────────────
  // One sign-in, several organizations. Everything here acts on the account
  // behind the verified token — never on an account id from the client.

  r.route({
    method: 'GET',
    url: '/organizations',
    preHandler: [app.authenticateTenant],
    schema: {
      tags: ['auth'],
      summary: 'Every organization you belong to, for the switcher',
      description:
        'Each with name, status, your role, whether it can be opened, whether it ' +
        'is current or your default, and your unread notifications there. ' +
        '`ownership` reports organizations you own against your limit.',
      security: [{ tenantToken: [] }],
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => ok(await membershipsService.list(request.auth!)),
  });

  r.route({
    method: 'POST',
    url: '/switch-organization',
    preHandler: [app.authenticateTenant],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['auth'],
      summary: 'Open another organization you belong to, without signing in again',
      description:
        'Answers with a tenant session for the target organization — the same ' +
        'shape as sign-in. Send `refreshToken` to end this device’s session in ' +
        'the organization being left. 404 when you are not a member; 403 ' +
        '`MEMBERSHIP_INACTIVE` when your access there is deactivated; 409 ' +
        '`ORGANIZATION_UNAVAILABLE` when the organization is suspended or its ' +
        'trial has lapsed.',
      security: [{ tenantToken: [] }],
      body: z.object({
        organizationId: objectIdSchema,
        refreshToken: z.string().optional(),
      }),
      response: { 200: okEnvelope, ...commonErrors, 409: commonErrors[400] },
    },
    handler: async (request) => {
      const result = await membershipsService.switchTo(request.auth!, request.body.organizationId, {
        refreshToken: request.body.refreshToken,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      request.log.info(
        {
          fromOrgId: request.auth!.organizationId.toString(),
          toOrgId: result.organization._id.toString(),
        },
        'organization switched'
      );
      return ok(tenantSession(result));
    },
  });

  r.route({
    method: 'PUT',
    url: '/default-organization',
    preHandler: [app.authenticateTenant],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['auth'],
      summary: 'Choose the organization that opens first when you sign in',
      description: '`null` clears it; sign-in then opens the organization you used last.',
      security: [{ tenantToken: [] }],
      body: z.object({ organizationId: objectIdSchema.nullable() }),
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) =>
      ok(await membershipsService.setDefault(request.auth!, request.body.organizationId)),
  });

  r.route({
    method: 'POST',
    url: '/organizations',
    preHandler: [app.authenticateTenant],
    // Creates a tenant — expensive and abusable, like public signup.
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
    schema: {
      tags: ['auth'],
      summary: 'Create another organization, owned by you, and open it',
      description:
        'For someone already in an organization; a person with none uses ' +
        '`POST /accounts/organizations`. Answers with a tenant session for the new ' +
        'organization. Send `refreshToken` to end this device’s session in the ' +
        'current one. 403 `ORGANIZATION_LIMIT_REACHED` past the number of ' +
        'organizations you may own; 409 when the handle is taken.',
      security: [{ tenantToken: [] }],
      body: createOrganizationBody.extend({ refreshToken: z.string().optional() }),
      response: { 201: okEnvelope, ...commonErrors, 409: commonErrors[400] },
    },
    handler: async (request, reply) => {
      const auth = request.auth!;
      const account = await Account.findById(auth.accountId);
      if (!account) throw AppError.unauthorized('Account not found');

      const { refreshToken, ...details } = request.body;
      const result = await accountOrganizationService.create(account, details, {
        via: 'membership',
        userId: auth.userId,
        refreshToken,
      });

      request.log.info(
        { orgId: result.organization._id.toString(), slug: result.organization.slug },
        'organization created by an existing member'
      );
      return reply.status(201).send(ok(tenantSession(result)));
    },
  });

  r.route({
    method: 'PUT',
    url: '/default-project',
    preHandler: [app.authenticateTenant],
    schema: {
      tags: ['auth'],
      summary: 'Set or clear your default lead grouping',
      security: [{ tenantToken: [] }],
      body: z.object({
        defaultProjectId: objectIdSchema.nullable(),
      }),
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const user = await User.findById(request.auth!.userId);
      if (!user) throw AppError.notFound('User not found');

      const { defaultProjectId } = request.body;
      if (defaultProjectId) {
        // Scoped by the tenant plugin, so a project id from another tenant
        // simply is not found rather than being silently accepted.
        const project = await Project.findById(defaultProjectId).select('_id').lean();
        if (!project) throw AppError.notFound('Project not found');
        user.defaultProject = project._id;
      } else {
        user.defaultProject = undefined;
      }

      await user.save();
      await user.populate([
        { path: 'projects', select: 'name color' },
        { path: 'defaultProject', select: 'name color' },
      ]);
      return ok(user.toJSON());
    },
  });

  r.route({
    method: 'PUT',
    url: '/me',
    preHandler: [app.authenticateTenant],
    schema: {
      tags: ['auth'],
      summary: 'Update own profile',
      description:
        'Name and email belong to your account and change everywhere you are a ' +
        'member; a new email must not already be linked to another person. ' +
        'Designation, avatar and language are per organization.',
      security: [{ tenantToken: [] }],
      body: updateMeBody,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const auth = request.auth!;
      // Whitelisted assignment: spreading the body would let a caller set
      // `role`, `permissions` or `isActive` on themselves.
      const { name, email, avatarUrl, designation, locale } = request.body;
      if (email === '') {
        throw AppError.badRequest('Email is required — it is how you sign in.');
      }

      if (name !== undefined || email !== undefined) {
        await identityService.updateIdentity(auth.user.accountId, { name, email });
      }

      // Re-read: the identity update rewrote this membership's copy of the name
      // and email.
      const user = await User.findById(auth.userId);
      if (!user) throw AppError.notFound('User not found');

      if (avatarUrl !== undefined) user.avatarUrl = avatarUrl;
      if (designation !== undefined) user.designation = designation;
      if (locale !== undefined) user.locale = locale;
      await user.save();

      return ok(user.toJSON());
    },
  });

  r.route({
    method: 'POST',
    url: '/change-password',
    preHandler: [app.authenticateTenant],
    config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
    schema: {
      tags: ['auth'],
      summary: 'Change your password (revokes every session, in every organization)',
      security: [{ tenantToken: [] }],
      body: changePasswordBody,
      response: { 200: messageEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const auth = request.auth!;
      await authService.changePassword(
        auth.userId,
        request.body.currentPassword,
        request.body.newPassword
      );
      return message('Password changed. Please sign in again.');
    },
  });

  r.route({
    method: 'POST',
    url: '/push-token',
    preHandler: [app.authenticateTenant],
    schema: {
      tags: ['auth'],
      summary: 'Register an Expo push token for reminders',
      security: [{ tenantToken: [] }],
      body: pushTokenBody,
      response: { 200: messageEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      await authService.updatePushToken(request.auth!.userId, request.body.pushToken);
      return message('Push token registered');
    },
  });

  r.route({
    method: 'POST',
    url: '/logout',
    preHandler: [app.authenticateTenant],
    schema: {
      tags: ['auth'],
      summary: 'Sign out of this session',
      security: [{ tenantToken: [] }],
      body: z.object({ refreshToken: z.string().optional() }),
      response: { 200: messageEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      await authService.logout(request.auth!.userId, request.body.refreshToken);
      return message('Signed out');
    },
  });

  r.route({
    method: 'POST',
    url: '/logout-all',
    preHandler: [app.authenticateTenant],
    schema: {
      tags: ['auth'],
      summary: 'Sign out of every session on every device, in every organization',
      security: [{ tenantToken: [] }],
      response: { 200: messageEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      await authService.logoutAll(request.auth!.userId);
      return message('Signed out everywhere');
    },
  });
}
