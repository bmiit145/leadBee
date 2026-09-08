import type { Types } from 'mongoose';
import type { IUser } from '../models/User.js';
import type { IOrganization } from '../models/Organization.js';
import type { IPlatformAdmin } from '../models/PlatformAdmin.js';

/** Who is calling, on a tenant route. */
export interface TenantAuth {
  realm: 'tenant';
  user: IUser;
  organization: IOrganization;
  userId: Types.ObjectId;
  organizationId: Types.ObjectId;
  role: string;
  /** Role permissions ∪ per-user grants, already merged. */
  permissions: string[];
  isOrganizer: boolean;
}

/** Who is calling, on a control-plane route. */
export interface PlatformAuth {
  realm: 'platform';
  admin: IPlatformAdmin;
  adminId: Types.ObjectId;
  role: string;
  permissions: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `authenticateTenant`. */
    auth?: TenantAuth;
    /** Set by `authenticatePlatform`. */
    platformAuth?: PlatformAuth;
  }

  interface FastifyInstance {
    /** preHandler: verify a tenant token, load user + org, open the tenant scope. */
    authenticateTenant: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;

    /** preHandler: verify a platform token and open a cross-tenant scope. */
    authenticatePlatform: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;

    /** preHandler factory: require any one of these permissions. */
    requirePermission: (
      ...permissions: string[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

    /** preHandler factory: require an organizer (owner/admin/manager or users.manage). */
    requireOrganizer: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;

    /** preHandler factory: require a platform permission. */
    requirePlatformPermission: (
      ...permissions: string[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
