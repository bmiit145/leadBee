import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { Organization } from '../models/Organization.js';
import { PlatformAdmin } from '../models/PlatformAdmin.js';
import { User } from '../models/User.js';
import { Role } from '../models/Role.js';
import { AppError } from '../lib/errors.js';
import {
  openScopeContainer,
  setTenantScope,
  setUnscoped,
} from '../lib/tenantContext.js';
import {
  verifyAccessToken,
  type PlatformTokenPayload,
  type TenantTokenPayload,
} from '../lib/tokens.js';
import { ORGANIZER_ROLES, PERMISSIONS } from '../config/constants.js';
import type { PlatformAuth, TenantAuth } from '../types/fastify.js';

export const authPlugin = fp(async function authPlugin(app: FastifyInstance) {
  /**
   * Open an empty tenant-scope container around the entire request.
   *
   * It has to be `onRequest` — the earliest hook — because a scope opened later
   * would not span the route handler. It starts empty; the authenticate hooks
   * fill it in once they know who is calling. See lib/tenantContext.ts.
   */
  app.addHook('onRequest', (_request, _reply, done) => {
    openScopeContainer(done);
  });

  // ─── Tenant realm ───────────────────────────────────────────────────────────
  app.decorate(
    'authenticateTenant',
    async function authenticateTenant(request: FastifyRequest): Promise<void> {
      const token = bearerToken(request);
      const payload = verifyAccessToken<TenantTokenPayload>('tenant', token);

      if (!Types.ObjectId.isValid(payload.org) || !Types.ObjectId.isValid(payload.sub)) {
        throw AppError.unauthorized('Malformed token subject');
      }

      const organizationId = new Types.ObjectId(payload.org);
      const userId = new Types.ObjectId(payload.sub);

      // Provisional scope, taken from the signed token so that the User lookup
      // below — which is itself tenant-scoped — has something to filter on.
      setTenantScope({
        organizationId,
        userId,
        role: payload.role,
        permissions: payload.permissions ?? [],
      });

      const organization = await Organization.findById(organizationId);
      if (!organization) throw AppError.unauthorized('Organization not found');

      if (!organization.isUsable()) {
        throw AppError.orgInactive(
          organization.status === 'suspended'
            ? 'This organization has been suspended. Contact support.'
            : 'This organization is not active. Contact your administrator.',
          { status: organization.status }
        );
      }

      // Scoped by the plugin, so a token whose `org` does not match the user's
      // row simply finds nothing — defence in depth behind the signature check.
      const user = await User.findById(userId);
      if (!user) throw AppError.unauthorized('User not found');
      if (!user.isActive) {
        throw AppError.forbidden('This account has been deactivated.');
      }

      // Permissions are recomputed from the database rather than trusted from
      // the token. Costs one indexed read; buys immediate revocation instead of
      // "revoked, but still works until the access token expires". If this ever
      // shows up in a profile, cache it per (userId, roleId) with a short TTL —
      // do not go back to trusting the token.
      const permissions = await effectivePermissions(user.roleId, user.permissions);

      setTenantScope({
        organizationId,
        userId,
        role: user.role,
        permissions,
      });

      const auth: TenantAuth = {
        realm: 'tenant',
        user,
        organization,
        userId,
        organizationId,
        role: user.role,
        permissions,
        isOrganizer: computeIsOrganizer(user.role, permissions),
      };
      request.auth = auth;

      // Every log line for this request carries the tenant, which is what makes
      // "show me everything that happened for customer X" a one-line query.
      bindToLog(request, {
        orgId: organizationId.toString(),
        userId: userId.toString(),
      });
    }
  );

  // ─── Platform realm ─────────────────────────────────────────────────────────
  app.decorate(
    'authenticatePlatform',
    async function authenticatePlatform(request: FastifyRequest): Promise<void> {
      const token = bearerToken(request);
      const payload = verifyAccessToken<PlatformTokenPayload>('platform', token);

      if (!Types.ObjectId.isValid(payload.sub)) {
        throw AppError.unauthorized('Malformed token subject');
      }

      const admin = await PlatformAdmin.findById(payload.sub);
      if (!admin || !admin.isActive) {
        throw AppError.unauthorized('Platform account not found or disabled');
      }
      if (admin.isLocked()) {
        throw AppError.forbidden('Account temporarily locked. Try again later.');
      }

      // The control plane reads across tenants by definition. Naming the reason
      // here is what keeps `withoutTenantScope` greppable as an audit surface.
      setUnscoped(`platform-admin:${admin.email}`);

      const platformAuth: PlatformAuth = {
        realm: 'platform',
        admin,
        adminId: admin._id,
        role: admin.role,
        permissions: admin.permissions(),
      };
      request.platformAuth = platformAuth;

      bindToLog(request, { platformAdmin: admin.email });
    }
  );

  // ─── Guards ─────────────────────────────────────────────────────────────────
  app.decorate('requirePermission', function requirePermission(...permissions: string[]) {
    return async function guard(request: FastifyRequest): Promise<void> {
      const auth = request.auth;
      if (!auth) throw AppError.unauthorized();
      if (hasAny(auth.permissions, permissions)) return;
      throw AppError.forbidden(
        `Missing required permission: ${permissions.join(' or ')}`
      );
    };
  });

  app.decorate('requireOrganizer', async function requireOrganizer(
    request: FastifyRequest
  ): Promise<void> {
    const auth = request.auth;
    if (!auth) throw AppError.unauthorized();
    if (!auth.isOrganizer) {
      throw AppError.forbidden('Only organizers can perform this action');
    }
  });

  app.decorate(
    'requirePlatformPermission',
    function requirePlatformPermission(...permissions: string[]) {
      return async function guard(request: FastifyRequest): Promise<void> {
        const platformAuth = request.platformAuth;
        if (!platformAuth) throw AppError.unauthorized();
        if (hasAny(platformAuth.permissions, permissions)) return;
        throw AppError.forbidden(
          `Missing required platform permission: ${permissions.join(' or ')}`
        );
      };
    }
  );
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Attach fields to every subsequent log line for this request.
 *
 * `setBindings` is pino's, not Fastify's — `FastifyBaseLogger` does not declare
 * it, and older pino versions do not have it. Feature-detected rather than
 * assumed, because losing a log annotation must not fail a request.
 */
function bindToLog(request: FastifyRequest, bindings: Record<string, string>): void {
  const log = request.log as unknown as {
    setBindings?: (b: Record<string, string>) => void;
  };
  log.setBindings?.(bindings);
}

function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw AppError.unauthorized('No token provided');
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token) throw AppError.unauthorized('No token provided');
  return token;
}

function hasAny(granted: string[], required: string[]): boolean {
  if (granted.includes(PERMISSIONS.ALL)) return true;
  return required.some((p) => granted.includes(p));
}

/**
 * An "organizer" sees every lead in the organization; everyone else sees only
 * what is assigned to or created by them.
 *
 * Determined by an admin-level role **or** the `users.manage` grant, so a
 * customer can promote someone to full visibility without inventing a new role.
 */
function computeIsOrganizer(role: string, permissions: string[]): boolean {
  if ((ORGANIZER_ROLES as string[]).includes(role)) return true;
  return (
    permissions.includes(PERMISSIONS.ALL) ||
    permissions.includes(PERMISSIONS.USERS_MANAGE)
  );
}

/** Role permissions ∪ per-user grants. */
async function effectivePermissions(
  roleId: Types.ObjectId | undefined,
  userPermissions: string[] = []
): Promise<string[]> {
  if (!roleId) return [...new Set(userPermissions)];
  const role = await Role.findById(roleId).select('permissions').lean();
  return [...new Set([...(role?.permissions ?? []), ...userPermissions])];
}
