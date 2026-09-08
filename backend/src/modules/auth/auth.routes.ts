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
import { Project } from '../../models/Project.js';
import { AppError } from '../../lib/errors.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'POST',
    url: '/login',
    // Brute-force ceiling, keyed on IP because there is no user yet.
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['auth'],
      summary: 'Sign in with phone and password',
      description:
        'Returns a token pair. If the phone belongs to more than one organization, ' +
        'responds 409 with `error.details.organizations` — resubmit including ' +
        '`organizationId`.',
      body: loginBody,
      response: { 200: okEnvelope, ...commonErrors, 409: commonErrors[400] },
    },
    handler: async (request, reply) => {
      const { phone, password, organizationId } = request.body;
      const result = await authService.login(phone, password, organizationId);

      if ('needsOrgSelection' in result) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'ORGANIZATION_SELECTION_REQUIRED',
            message: 'This phone number belongs to more than one organization.',
            details: { organizations: result.organizations },
          },
          requestId: request.id,
        });
      }

      return reply.send(
        ok({
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
      security: [{ tenantToken: [] }],
      body: updateMeBody,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const auth = request.auth!;
      // Whitelisted assignment: spreading the body would let a caller set
      // `role`, `permissions` or `isActive` on themselves.
      const { name, email, avatarUrl, designation, locale } = request.body;
      const user = await User.findById(auth.userId);
      if (!user) throw AppError.notFound('User not found');

      if (name !== undefined) user.name = name;
      if (email !== undefined) user.email = email || undefined;
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
      summary: 'Change own password (revokes every session)',
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
      summary: 'Sign out of every session on every device',
      security: [{ tenantToken: [] }],
      response: { 200: messageEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      await authService.logoutAll(request.auth!.userId);
      return message('Signed out everywhere');
    },
  });
}
