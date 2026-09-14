import { Types } from 'mongoose';
import { Account } from '../../models/Account.js';
import { User } from '../../models/User.js';
import { Organization } from '../../models/Organization.js';
import { Notification } from '../../models/Notification.js';
import { AppError } from '../../lib/errors.js';
import { runInTenantScope, withoutTenantScope } from '../../lib/tenantContext.js';
import { AUDIT_ACTIONS, ORG_STATUSES } from '../../config/constants.js';
import type { TenantAuth } from '../../types/fastify.js';
import { authService, type LoginResult } from '../auth/auth.service.js';
import { auditService } from '../audit/audit.service.js';
import { ownershipOf, type Ownership } from './accountOrganization.service.js';

/**
 * The organizations one signed-in person belongs to: listing them for the
 * switcher, moving between them, and choosing which opens first.
 *
 * Every read here crosses tenants — a person's memberships live in different
 * organizations — so each is `withoutTenantScope` with its reason (ARCH-4), and
 * each is keyed on the account id from the verified token, never on anything
 * the client sent. See ADR-0004, "Several organizations".
 */

export interface OrganizationSummary {
  _id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  /** The person's role in that organization. */
  role: string;
  /** False when their access there has been deactivated. */
  membershipActive: boolean;
  /** False when the organization is suspended, cancelled or its trial lapsed. */
  usable: boolean;
  isCurrent: boolean;
  isDefault: boolean;
  unreadNotifications: number;
}

export interface OrganizationsOverview {
  organizations: OrganizationSummary[];
  ownership: Ownership;
}

interface MembershipRow {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  role: string;
  isActive: boolean;
}

const openable = (org: OrganizationSummary) => org.membershipActive && org.usable;

/** Current first, then the ones that can be opened, then by name. */
function bySwitcherOrder(a: OrganizationSummary, b: OrganizationSummary): number {
  if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
  if (openable(a) !== openable(b)) return openable(a) ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export const membershipsService = {
  async list(auth: TenantAuth): Promise<OrganizationsOverview> {
    const account = await Account.findById(auth.accountId).select(
      'defaultOrganizationId ownedOrganizationLimit'
    );
    if (!account) throw AppError.unauthorized('Account not found');

    const memberships = await withoutTenantScope(
      'memberships: every organization this person belongs to',
      () =>
        User.find({ accountId: auth.accountId })
          .select('organizationId role isActive')
          .lean<MembershipRow[]>()
          .exec()
    );
    const organizationIds = memberships.map((membership) => membership.organizationId);

    const [organizations, unread, ownership] = await Promise.all([
      withoutTenantScope('memberships: the organizations behind them', () =>
        Organization.find({ _id: { $in: organizationIds } })
          .select('name slug status plan trialEndsAt')
          .exec()
      ),
      // Led by organizationId, so it runs on the { organizationId, recipient,
      // readAt } index rather than scanning notifications.
      withoutTenantScope('memberships: unread notifications in each organization', () =>
        Notification.aggregate<{ _id: Types.ObjectId; count: number }>([
          {
            $match: {
              organizationId: { $in: organizationIds },
              recipient: { $in: memberships.map((membership) => membership._id) },
              readAt: null,
            },
          },
          { $group: { _id: '$recipient', count: { $sum: 1 } } },
        ]).exec()
      ),
      ownershipOf(account),
    ]);

    const organizationsById = new Map(organizations.map((org) => [org._id.toString(), org]));
    const unreadByMembership = new Map(unread.map((row) => [row._id.toString(), row.count]));

    const summaries = memberships.flatMap((membership): OrganizationSummary[] => {
      const org = organizationsById.get(membership.organizationId.toString());
      // A membership whose organization is gone cannot be opened or shown.
      if (!org) return [];
      return [
        {
          _id: org._id.toString(),
          name: org.name,
          slug: org.slug,
          status: org.status,
          plan: org.plan,
          role: membership.role,
          membershipActive: membership.isActive,
          usable: org.isUsable(),
          isCurrent: org._id.equals(auth.organizationId),
          isDefault: account.defaultOrganizationId?.equals(org._id) ?? false,
          unreadNotifications: unreadByMembership.get(membership._id.toString()) ?? 0,
        },
      ];
    });

    return { organizations: summaries.sort(bySwitcherOrder), ownership };
  },

  /**
   * Opens another organization the same person belongs to, without a password:
   * the account is already verified on this request, and the membership and
   * organization are checked here.
   */
  async switchTo(
    auth: TenantAuth,
    organizationId: string,
    context: { refreshToken?: string; ip?: string; userAgent?: string }
  ): Promise<LoginResult> {
    if (auth.organizationId.equals(organizationId)) {
      throw AppError.badRequest('You are already in this organization.');
    }

    const target = await withoutTenantScope(
      'switch organization: this person’s membership in the target',
      () =>
        User.findOne({
          accountId: auth.accountId,
          organizationId: new Types.ObjectId(organizationId),
        })
          .select('+refreshTokens')
          .exec()
    );
    // "No such organization" and "not a member" answer alike, so an id reveals
    // nothing about organizations this person cannot see.
    if (!target) throw AppError.notFound('You are not a member of that organization.');
    if (!target.isActive) {
      throw new AppError(
        'Your access to that organization has been deactivated. Contact its administrator.',
        403,
        'MEMBERSHIP_INACTIVE'
      );
    }

    const organization = await withoutTenantScope('switch organization: load the target tenant', () =>
      Organization.findById(target.organizationId).exec()
    );
    if (!organization) throw AppError.notFound('You are not a member of that organization.');
    // Not ORGANIZATION_INACTIVE: clients read that as "the organization you are
    // in is paused" and lock the app. Here the current one is fine.
    if (!organization.isUsable()) {
      throw new AppError(
        organization.status === ORG_STATUSES.SUSPENDED
          ? 'That organization has been suspended.'
          : 'That organization is not active.',
        409,
        'ORGANIZATION_UNAVAILABLE',
        { status: organization.status }
      );
    }

    // This device leaves the current organization: its session there ends, and
    // its push token goes with it so that organization's alerts stop arriving.
    await authService.logout(auth.userId, context.refreshToken);
    const result = await authService.openMembershipSession(target, organization);

    // Recorded in the organization entered, whose admins answer "who has been
    // in here". Nothing about the organization left is written into it.
    await runInTenantScope(
      {
        organizationId: target.organizationId,
        userId: target._id,
        role: target.role,
        permissions: [],
      },
      () =>
        auditService.record({
          action: AUDIT_ACTIONS.ORGANIZATION_SWITCHED_IN,
          entityType: 'user',
          entityId: target._id,
          actor: { userId: target._id, name: target.name, role: target.role, isOrganizer: false },
          origin: { ip: context.ip, userAgent: context.userAgent },
        })
    );

    return result;
  },

  /** `null` clears the default; sign-in then opens the organization used last. */
  async setDefault(auth: TenantAuth, organizationId: string | null): Promise<OrganizationsOverview> {
    if (organizationId === null) {
      await Account.updateOne({ _id: auth.accountId }, { $unset: { defaultOrganizationId: 1 } });
      return membershipsService.list(auth);
    }

    const isMember = await withoutTenantScope('default organization: confirm the membership', () =>
      User.exists({
        accountId: auth.accountId,
        organizationId: new Types.ObjectId(organizationId),
        isActive: true,
      }).exec()
    );
    if (!isMember) throw AppError.notFound('You are not an active member of that organization.');

    await Account.updateOne(
      { _id: auth.accountId },
      { $set: { defaultOrganizationId: new Types.ObjectId(organizationId) } }
    );
    return membershipsService.list(auth);
  },
};
