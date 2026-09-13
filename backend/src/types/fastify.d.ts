import type { Types } from 'mongoose';
import type { IUser } from '../models/User.js';
import type { IOrganization } from '../models/Organization.js';
import type { IPlatformAdmin } from '../models/PlatformAdmin.js';
import type { IAccount } from '../models/Account.js';

/** Who is calling, on a tenant route. */
export interface TenantAuth {
  realm: 'tenant';
  user: IUser;
  organization: IOrganization;
  userId: Types.ObjectId;
  /** The person behind this membership — see models/Account.ts. */
  accountId: Types.ObjectId;
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

/**
 * Who is calling, on an account route: a signed-in person who belongs to no
 * organization. No tenant scope, no permissions — only their own account.
 */
export interface AccountAuth {
  realm: 'account';
  account: IAccount;
  accountId: Types.ObjectId;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `authenticateTenant`. */
    auth?: TenantAuth;
    /** Set by `authenticatePlatform`. */
    platformAuth?: PlatformAuth;
    /** Set by `authenticateAccount`. */
    accountAuth?: AccountAuth;
  }

  interface FastifyInstance {
    /** preHandler: verify a tenant token, load user + org, open the tenant scope. */
    authenticateTenant: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;

    /** preHandler: verify an account token and load the account. Opens no scope. */
    authenticateAccount: (
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
