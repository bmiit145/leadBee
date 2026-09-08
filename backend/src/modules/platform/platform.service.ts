import { Types, type FilterQuery } from 'mongoose';
import { Organization, type IOrganization } from '../../models/Organization.js';
import { User } from '../../models/User.js';
import { Lead } from '../../models/Lead.js';
import { PlatformAuditLog } from '../../models/PlatformAuditLog.js';
import type { IPlatformAdmin } from '../../models/PlatformAdmin.js';
import { AppError } from '../../lib/errors.js';
import { pageParams } from '../../lib/pagination.js';
import { runInTenantScope } from '../../lib/tenantContext.js';
import { ORG_STATUSES, ROLES, type OrgStatus } from '../../config/constants.js';

/**
 * The control plane's view of the estate.
 *
 * Every read here is deliberately cross-tenant. The platform routes run under a
 * `setUnscoped` scope opened by `authenticatePlatform`, so the tenant plugin
 * stands down; where a genuinely tenant-scoped operation is needed (listing one
 * org's users) the code re-enters a tenant scope explicitly.
 */

export interface OrgListFilters {
  status?: OrgStatus;
  plan?: string;
  search?: string;
  page?: number;
  limit?: number;
  sort?: 'newest' | 'oldest' | 'name' | 'users' | 'leads';
}

const SORTS: Record<string, Record<string, 1 | -1>> = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  name: { name: 1 },
  users: { 'usage.users': -1 },
  leads: { 'usage.leads': -1 },
};

export const platformService = {
  async listOrganizations(filters: OrgListFilters) {
    const query: FilterQuery<IOrganization> = {};
    if (filters.status) query.status = filters.status;
    if (filters.plan) query.plan = filters.plan;
    if (filters.search) {
      const regex = new RegExp(
        filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i'
      );
      query.$or = [{ name: regex }, { slug: regex }, { billingEmail: regex }];
    }

    const { page, limit, skip } = pageParams(filters);
    const sort = SORTS[filters.sort ?? 'newest'] ?? SORTS.newest!;

    const [data, total] = await Promise.all([
      Organization.find(query).sort(sort).skip(skip).limit(limit).lean(),
      Organization.countDocuments(query),
    ]);

    return { data, total, page, limit };
  },

  async getOrganization(organizationId: string) {
    const organization = await Organization.findById(organizationId).lean();
    if (!organization) throw AppError.notFound('Organization not found');

    // Counters on the org document are rolling and can drift. The detail view is
    // rare enough to afford the authoritative count.
    //
    // These filter on organizationId by hand because the platform realm runs
    // unscoped — the tenant plugin stands down here, so the predicate has to be
    // written out rather than injected.
    const orgObjectId = new Types.ObjectId(organizationId);
    const [users, activeUsers, leads, owner] = await Promise.all([
      User.countDocuments({ organizationId: orgObjectId }),
      User.countDocuments({ organizationId: orgObjectId, isActive: true }),
      Lead.countDocuments({ organizationId: orgObjectId, isActive: true }),
      User.findOne({ organizationId: orgObjectId, role: ROLES.OWNER })
        .select('name email phone lastLoginAt')
        .lean(),
    ]);

    return { ...organization, counts: { users, activeUsers, leads }, owner };
  },

  /**
   * Suspend or reactivate a tenant.
   *
   * Suspension takes effect on the *next request*, not the next token refresh:
   * the auth plugin checks `organization.isUsable()` on every call, so an
   * outstanding 15-minute access token does not buy a suspended tenant extra
   * time.
   */
  async setOrganizationStatus(
    organizationId: string,
    status: OrgStatus,
    admin: IPlatformAdmin,
    reason?: string,
    context: { ip?: string; userAgent?: string } = {}
  ): Promise<IOrganization> {
    const organization = await Organization.findById(organizationId);
    if (!organization) throw AppError.notFound('Organization not found');

    const before = { status: organization.status, suspendedReason: organization.suspendedReason };

    organization.status = status;
    if (status === ORG_STATUSES.SUSPENDED) {
      organization.suspendedAt = new Date();
      organization.suspendedReason = reason;
    } else {
      organization.suspendedAt = undefined;
      organization.suspendedReason = undefined;
    }
    await organization.save();

    await recordPlatformAction({
      action: 'org_status_changed',
      organization,
      admin,
      reason,
      before,
      after: { status },
      ...context,
    });

    return organization;
  },

  /**
   * Estate-wide numbers for the console's landing page.
   *
   * These are aggregations over every tenant. At a few thousand orgs they are
   * fine on demand; past that they belong in a materialised rollup refreshed on
   * a schedule rather than computed per page view.
   */
  async metrics() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [byStatus, byPlan, totals, recentSignups, expiringTrials] = await Promise.all([
      Organization.aggregate<{ _id: string; count: number }>([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Organization.aggregate<{ _id: string; count: number }>([
        { $group: { _id: '$plan', count: { $sum: 1 } } },
      ]),
      Organization.aggregate<{
        _id: null;
        organizations: number;
        users: number;
        leads: number;
      }>([
        {
          $group: {
            _id: null,
            organizations: { $sum: 1 },
            users: { $sum: '$usage.users' },
            leads: { $sum: '$usage.leads' },
          },
        },
      ]),
      Organization.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      Organization.countDocuments({
        status: ORG_STATUSES.TRIALING,
        trialEndsAt: { $gte: now, $lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) },
      }),
    ]);

    const totalsRow = totals[0] ?? { organizations: 0, users: 0, leads: 0 };

    return {
      totals: {
        organizations: totalsRow.organizations,
        users: totalsRow.users,
        leads: totalsRow.leads,
      },
      byStatus: toMap(byStatus),
      byPlan: toMap(byPlan),
      recentSignups,
      expiringTrials,
      generatedAt: now.toISOString(),
    };
  },

  /** Users inside one tenant, read through a real tenant scope. */
  async listOrganizationUsers(organizationId: string, page = 1, limit = 25) {
    const orgObjectId = new Types.ObjectId(organizationId);
    const params = pageParams({ page, limit });

    return runInTenantScope(
      {
        organizationId: orgObjectId,
        // No tenant user is acting; the platform admin is. A placeholder id
        // keeps the scope well-formed for reads, which is all this does.
        userId: new Types.ObjectId(),
        role: 'platform',
        permissions: ['*'],
      },
      async () => {
        const [data, total] = await Promise.all([
          User.find()
            .select('name phone email role designation isActive lastLoginAt createdAt')
            .sort({ createdAt: -1 })
            .skip(params.skip)
            .limit(params.limit)
            .lean(),
          User.countDocuments(),
        ]);
        return { data, total, page: params.page, limit: params.limit };
      }
    );
  },

  /**
   * Deactivate or reactivate one tenant user from the console — the "manage all
   * users as active and non-active" control.
   */
  async setUserActive(
    organizationId: string,
    userId: string,
    isActive: boolean,
    admin: IPlatformAdmin,
    context: { ip?: string; userAgent?: string } = {}
  ) {
    const orgObjectId = new Types.ObjectId(organizationId);
    const organization = await Organization.findById(orgObjectId);
    if (!organization) throw AppError.notFound('Organization not found');

    const user = await runInTenantScope(
      {
        organizationId: orgObjectId,
        userId: new Types.ObjectId(),
        role: 'platform',
        permissions: ['*'],
      },
      async () => {
        const found = await User.findById(userId).select('+refreshTokens');
        if (!found) throw AppError.notFound('User not found in this organization');

        found.isActive = isActive;
        // Deactivation must end current sessions, not merely block new logins.
        if (!isActive) found.refreshTokens = [];
        await found.save();
        return found;
      }
    );

    await Organization.updateOne(
      { _id: orgObjectId },
      { $inc: { 'usage.users': isActive ? 1 : -1 } }
    );

    await recordPlatformAction({
      action: isActive ? 'user_reactivated' : 'user_deactivated',
      organization,
      admin,
      targetType: 'User',
      targetId: user._id,
      after: { isActive },
      ...context,
    });

    return user;
  },

  async auditLog(filters: { organizationId?: string; page?: number; limit?: number }) {
    const query: Record<string, unknown> = {};
    if (filters.organizationId) {
      query.organizationId = new Types.ObjectId(filters.organizationId);
    }

    const { page, limit, skip } = pageParams(filters);
    const [data, total] = await Promise.all([
      PlatformAuditLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      PlatformAuditLog.countDocuments(query),
    ]);

    return { data, total, page, limit };
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface PlatformActionInput {
  action: string;
  organization?: IOrganization;
  admin: IPlatformAdmin;
  targetType?: string;
  targetId?: Types.ObjectId;
  reason?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

/**
 * Write the platform audit row.
 *
 * Awaited, not fire-and-forget: "who suspended this customer" must not be the
 * record that goes missing when the process restarts mid-request.
 */
export async function recordPlatformAction(input: PlatformActionInput): Promise<void> {
  await PlatformAuditLog.create({
    action: input.action,
    organizationId: input.organization?._id,
    organizationName: input.organization?.name,
    targetType: input.targetType,
    targetId: input.targetId,
    adminId: input.admin._id,
    adminEmail: input.admin.email,
    adminRole: input.admin.role,
    reason: input.reason,
    before: input.before,
    after: input.after,
    ip: input.ip,
    userAgent: input.userAgent,
  });
}

function toMap(rows: Array<{ _id: string; count: number }>): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, { _id, count }) => {
    if (_id) acc[_id] = count;
    return acc;
  }, {});
}
