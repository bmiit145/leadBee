import { Types, type FilterQuery, type ClientSession } from 'mongoose';
import { JoinCode, type IJoinCode } from '../../models/JoinCode.js';
import {
  OrganizationInvite,
  type IOrganizationInvite,
  type InviteStatus,
} from '../../models/OrganizationInvite.js';
import { JoinRequest, type IJoinRequest, type JoinRequestStatus } from '../../models/JoinRequest.js';
import { Organization, type IOrganization } from '../../models/Organization.js';
import { User } from '../../models/User.js';
import { Account, type IAccount } from '../../models/Account.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { pageParams } from '../../lib/pagination.js';
import { requireOrganizationId, runInTenantScope, withoutTenantScope } from '../../lib/tenantContext.js';
import { withOptionalTransaction } from '../../lib/transactions.js';
import { ORGANIZER_ROLES, ROLES, type Role } from '../../config/constants.js';
import { organizationService } from '../organizations/organization.service.js';
import { memberService } from '../users/member.service.js';
import { notificationService } from '../notifications/notification.service.js';
import { authService, type LoginResult } from '../auth/auth.service.js';
import { accountSessionService } from '../accounts/accountSession.service.js';
import type { Viewer } from '../leads/lead.service.js';
import {
  INVITE_ERROR,
  INVITE_EXPIRY_DAYS,
  JOIN_CODE_EXPIRY_DAYS,
  assertLinkRole,
  codeIsOpen,
  daysFromNow,
  digestsMatch,
  formatJoinCode,
  generateInviteToken,
  generateJoinCode,
  hashInviteToken,
  invalidCode,
  inviteIsOpen,
  normalizeJoinCode,
} from './invitePolicy.js';

/** How the shareable link is presented, with the code already formatted. */
export interface JoinLinkView {
  _id: string;
  code: string;
  role: Role;
  requiresApproval: boolean;
  expiresAt?: string;
  maxUses?: number;
  uses: number;
  createdAt: string;
}

/** What someone holding a code is told before they commit to anything. */
export interface InvitePreview {
  organizationName: string;
  /** Organizations carry no logo yet; the app draws initials, as the switcher does. */
  memberCount: number;
  role: Role;
  requiresApproval: boolean;
  /** Set when the caller already belongs to this organization. */
  alreadyMember: boolean;
}

/** The outcome of using a code or a token. */
export type JoinOutcome =
  | { kind: 'joined'; session: LoginResult }
  | { kind: 'requested'; request: Record<string, unknown>; organizationName: string };

const MAX_ATTEMPTS_PER_CODE = 5;

export const inviteService = {
  // ─── Admin: the shareable link ────────────────────────────────────────────

  /** The organization's current link, or null when it has none yet. */
  async activeLink(): Promise<JoinLinkView | null> {
    const code = await JoinCode.findOne({ isActive: true });
    return code ? presentLink(code) : null;
  },

  /**
   * Issues the organization's link. Any previous one is retired first, which is
   * what "Reset link" does: every copy of the old link stops working at once.
   */
  async issueLink(
    viewer: Viewer,
    options: { role?: Role; requiresApproval?: boolean; expiresInDays?: number | null; maxUses?: number | null } = {}
  ): Promise<JoinLinkView> {
    const role = options.role ?? ROLES.USER;
    assertLinkRole(role);

    const now = new Date();
    await JoinCode.updateMany(
      { isActive: true },
      { $set: { isActive: false, revokedAt: now, revokedBy: viewer.userId } }
    );

    const expiresInDays = options.expiresInDays === undefined ? JOIN_CODE_EXPIRY_DAYS : options.expiresInDays;
    const created = await JoinCode.create({
      organizationId: requireOrganizationId(),
      code: await uniqueJoinCode(),
      role,
      requiresApproval: options.requiresApproval ?? true,
      expiresAt: expiresInDays == null ? undefined : daysFromNow(expiresInDays, now),
      maxUses: options.maxUses ?? undefined,
      createdBy: viewer.userId,
      createdByName: viewer.name,
    });
    return presentLink(created);
  },

  /** Changes the settings on the live link without changing the code itself. */
  async updateLink(
    viewer: Viewer,
    changes: { role?: Role; requiresApproval?: boolean; expiresInDays?: number | null; maxUses?: number | null }
  ): Promise<JoinLinkView> {
    const code = await JoinCode.findOne({ isActive: true });
    if (!code) throw AppError.notFound('This organization has no invite link yet.');

    if (changes.role !== undefined) {
      assertLinkRole(changes.role);
      code.role = changes.role;
    }
    if (changes.requiresApproval !== undefined) code.requiresApproval = changes.requiresApproval;
    if (changes.expiresInDays !== undefined) {
      code.expiresAt = changes.expiresInDays == null ? undefined : daysFromNow(changes.expiresInDays, new Date());
    }
    if (changes.maxUses !== undefined) code.maxUses = changes.maxUses ?? undefined;

    await code.save();
    logger.info({ userId: viewer.userId.toString() }, 'invite link settings changed');
    return presentLink(code);
  },

  /** Turns the link off without issuing another. */
  async revokeLink(viewer: Viewer): Promise<void> {
    await JoinCode.updateMany(
      { isActive: true },
      { $set: { isActive: false, revokedAt: new Date(), revokedBy: viewer.userId } }
    );
  },

  // ─── Admin: invitations by email ──────────────────────────────────────────

  /**
   * Invites one person by email.
   *
   * The token is returned **once**, in the link the admin shares; only its hash
   * is stored. No mail is sent yet — LeadBee has no mailer (registration codes
   * are in the same position), so the admin shares the link over WhatsApp, SMS
   * or their own email client.
   */
  async invite(
    viewer: Viewer,
    input: { email: string; phone?: string; role?: Role; message?: string }
  ): Promise<{ invite: Record<string, unknown>; token: string }> {
    const role = input.role ?? ROLES.USER;
    assertLinkRole(role);

    const email = input.email.trim().toLowerCase();
    const alreadyHere = await User.findOne({ email, isActive: true }).select('_id').lean();
    if (alreadyHere) {
      throw new AppError(
        'That person is already in this organization.',
        409,
        INVITE_ERROR.ALREADY_MEMBER
      );
    }

    const now = new Date();
    await expireLapsedInvites(now);

    const { token, tokenHash } = generateInviteToken();
    let created: IOrganizationInvite;
    try {
      created = await OrganizationInvite.create({
        organizationId: requireOrganizationId(),
        email,
        phone: input.phone,
        role,
        tokenHash,
        message: input.message,
        expiresAt: daysFromNow(INVITE_EXPIRY_DAYS, now),
        invitedBy: viewer.userId,
        invitedByName: viewer.name,
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      throw AppError.conflict('An invitation to that email is already waiting to be accepted.');
    }

    return { invite: presentInvite(created), token };
  },

  async listInvites(
    filters: { status?: InviteStatus; page?: number; limit?: number }
  ): Promise<{ data: Record<string, unknown>[]; total: number; page: number; limit: number }> {
    const now = new Date();
    await expireLapsedInvites(now);

    const query: FilterQuery<IOrganizationInvite> = filters.status ? { status: filters.status } : {};
    const { page, limit, skip } = pageParams(filters);
    const [rows, total] = await Promise.all([
      OrganizationInvite.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      OrganizationInvite.countDocuments(query),
    ]);
    return { data: rows.map(presentInvite), total, page, limit };
  },

  /** Withdraws an invitation. The link in it stops working immediately. */
  async revokeInvite(inviteId: string, viewer: Viewer): Promise<Record<string, unknown>> {
    const invite = await OrganizationInvite.findOneAndUpdate(
      { _id: inviteId, status: 'pending' },
      { $set: { status: 'revoked', revokedAt: new Date(), revokedBy: viewer.userId } },
      { new: true }
    );
    if (!invite) throw AppError.notFound('That invitation is not waiting to be accepted.');
    return presentInvite(invite);
  },

  // ─── Admin: requests to join ──────────────────────────────────────────────

  async listRequests(
    filters: { status?: JoinRequestStatus; page?: number; limit?: number }
  ): Promise<{ data: Record<string, unknown>[]; total: number; page: number; limit: number }> {
    const query: FilterQuery<IJoinRequest> = filters.status ? { status: filters.status } : {};
    const { page, limit, skip } = pageParams(filters);
    const [rows, total] = await Promise.all([
      JoinRequest.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      JoinRequest.countDocuments(query),
    ]);
    return { data: rows.map(presentRequest), total, page, limit };
  },

  /** What is waiting on an admin — the badge on "Invite members". */
  async pendingCounts(): Promise<{ requests: number; invites: number }> {
    const [requests, invites] = await Promise.all([
      JoinRequest.countDocuments({ status: 'pending' }),
      OrganizationInvite.countDocuments({ status: 'pending', expiresAt: { $gt: new Date() } }),
    ]);
    return { requests, invites };
  },

  /**
   * Approving creates the membership; rejecting closes the request and tells
   * the person nothing beyond that it was answered.
   */
  async decideRequest(
    requestId: string,
    decision: 'approve' | 'reject',
    viewer: Viewer,
    options: { role?: Role } = {}
  ): Promise<Record<string, unknown>> {
    return withOptionalTransaction(async (session) => {
      const request = await JoinRequest.findById(requestId).session(session ?? null);
      if (!request) throw AppError.notFound('Request not found');
      if (request.status !== 'pending') {
        throw new AppError('This request has already been answered.', 409, INVITE_ERROR.NOT_PENDING);
      }

      const now = new Date();
      if (decision === 'reject') {
        request.status = 'rejected';
        request.decidedBy = viewer.userId;
        request.decidedByName = viewer.name;
        request.decidedAt = now;
        await request.save({ session });
        return presentRequest(request);
      }

      const role = options.role ?? request.role;
      assertLinkRole(role);

      const organizationId = requireOrganizationId();
      const organization = await Organization.findById(organizationId).session(session ?? null);
      if (!organization) throw AppError.notFound('Organization not found');
      await organizationService.assertCanAddUser(organization);

      const account = await withoutTenantScope('join request: the account being approved', () =>
        Account.findById(request.accountId).session(session ?? null).exec()
      );
      if (!account) throw AppError.badRequest('That person no longer has a LeadBee account.');

      const membership = await memberService.addExistingAccount(organizationId, account, { role }, session);
      await Organization.updateOne({ _id: organizationId }, { $inc: { 'usage.users': 1 } }, { session });

      request.status = 'approved';
      request.role = role;
      request.decidedBy = viewer.userId;
      request.decidedByName = viewer.name;
      request.decidedAt = now;
      request.membership = membership._id;
      await request.save({ session });

      logger.info(
        { userId: membership._id.toString(), decidedBy: viewer.userId.toString() },
        'join request approved'
      );
      return presentRequest(request);
    });
  },

  // ─── Joining: everything below runs before the person has a membership ────

  /**
   * What a code leads to, before anyone commits.
   *
   * Cross-tenant by nature: the caller has no organization yet, so the lookup
   * cannot be tenant-scoped. Nothing is written, and only what someone needs to
   * recognise the organization is returned.
   */
  async preview(codeInput: string, account: IAccount): Promise<InvitePreview> {
    const code = normalizeJoinCode(codeInput);
    if (!code) throw invalidCode();

    const found = await withoutTenantScope('join: resolve an invite code to its organization', () =>
      JoinCode.findOne({ code }).exec()
    );
    if (!found || !codeIsOpen(found, new Date())) throw invalidCode();

    const [organization, memberCount, existing] = await withoutTenantScope(
      'join: describe the organization behind a code',
      async () => {
        const org = await Organization.findById(found.organizationId).exec();
        const members = await User.countDocuments({
          organizationId: found.organizationId,
          isActive: true,
        }).exec();
        const mine = await User.exists({
          organizationId: found.organizationId,
          accountId: account._id,
        }).exec();
        return [org, members, mine] as const;
      }
    );
    if (!organization) throw invalidCode();

    return {
      organizationName: organization.name,
      memberCount,
      role: found.role,
      requiresApproval: found.requiresApproval,
      alreadyMember: Boolean(existing),
    };
  },

  /**
   * Uses a join code: either the person is in, or their request is queued.
   *
   * The `uses` counter is raised with a conditional update, so a code with
   * `maxUses` cannot be redeemed past its limit by two people at once.
   */
  async join(account: IAccount, codeInput: string, message?: string): Promise<JoinOutcome> {
    const code = normalizeJoinCode(codeInput);
    if (!code) throw invalidCode();

    return withOptionalTransaction(async (session) => {
      const found = await withoutTenantScope('join: resolve an invite code to its organization', () =>
        JoinCode.findOne({ code }).session(session ?? null).exec()
      );
      if (!found || !codeIsOpen(found, new Date())) throw invalidCode();

      const organization = await withoutTenantScope('join: the organization being joined', () =>
        Organization.findById(found.organizationId).session(session ?? null).exec()
      );
      if (!organization) throw invalidCode();

      await assertNotAlreadyMember(found.organizationId, account._id, session);

      if (found.requiresApproval) {
        const request = await raiseJoinRequest(found, account, organization, message, session);
        return { kind: 'requested', request, organizationName: organization.name };
      }

      // Claim a use before the membership exists, so a limited code cannot be
      // over-redeemed; a failure afterwards costs one use, never an extra member.
      const claimed = await withoutTenantScope('join: claim one use of an invite code', () =>
        JoinCode.findOneAndUpdate(
          {
            _id: found._id,
            isActive: true,
            $or: [{ maxUses: { $exists: false } }, { $expr: { $lt: ['$uses', '$maxUses'] } }],
          },
          { $inc: { uses: 1 } },
          { new: true, session }
        ).exec()
      );
      if (!claimed) throw invalidCode();

      const membershipSession = await createMembershipSession(organization, account, found.role, session);
      return { kind: 'joined', session: membershipSession };
    });
  },

  /**
   * Accepts an emailed invitation.
   *
   * Only the person it was addressed to can: a forwarded link signed in as
   * somebody else is refused. That is what makes this the strongest door.
   */
  async acceptInvite(account: IAccount, token: string): Promise<JoinOutcome> {
    const tokenHash = hashInviteToken(token);
    return withOptionalTransaction(async (session) => {
      const invite = await withoutTenantScope('invite: resolve a token to its invitation', () =>
        OrganizationInvite.findOne({ tokenHash }).session(session ?? null).exec()
      );
      if (!invite || !digestsMatch(invite.tokenHash, tokenHash) || !inviteIsOpen(invite, new Date())) {
        throw invalidCode();
      }

      if (invite.email !== account.email.trim().toLowerCase()) {
        throw new AppError(
          `This invitation was sent to ${invite.email}. Sign in with that email to accept it.`,
          403,
          INVITE_ERROR.EMAIL_MISMATCH
        );
      }

      const organization = await withoutTenantScope('invite: the organization being joined', () =>
        Organization.findById(invite.organizationId).session(session ?? null).exec()
      );
      if (!organization) throw invalidCode();

      await assertNotAlreadyMember(invite.organizationId, account._id, session);

      // Single use: the first acceptance flips it, a second finds nothing.
      const claimed = await withoutTenantScope('invite: claim a single-use invitation', () =>
        OrganizationInvite.findOneAndUpdate(
          { _id: invite._id, status: 'pending' },
          { $set: { status: 'accepted', acceptedAt: new Date() } },
          { new: true, session }
        ).exec()
      );
      if (!claimed) throw invalidCode();

      const membershipSession = await createMembershipSession(organization, account, invite.role, session);

      await withoutTenantScope('invite: record which membership accepted it', () =>
        OrganizationInvite.updateOne(
          { _id: invite._id },
          { $set: { acceptedBy: membershipSession.user._id } },
          { session }
        ).exec()
      );

      return { kind: 'joined', session: membershipSession };
    });
  },

  /** Invitations addressed to this person, across organizations. */
  async myInvitations(account: IAccount): Promise<Record<string, unknown>[]> {
    const email = account.email.trim().toLowerCase();
    const now = new Date();
    const rows = await withoutTenantScope('invite: invitations addressed to this person', () =>
      OrganizationInvite.find({ email, status: 'pending', expiresAt: { $gt: now } })
        .sort({ createdAt: -1 })
        .limit(20)
        .exec()
    );

    const nameOf = await organizationNames(rows.map((row) => row.organizationId));

    // The token is not here: it is in the link the invitation was sent with,
    // and the point of hashing it is that the server cannot hand it back.
    return rows.map((row) => ({
      ...presentInvite(row),
      organizationName: nameOf.get(row.organizationId.toString()) ?? 'An organization',
    }));
  },

  /** Requests this person has raised, so they can see "waiting" and withdraw. */
  async myRequests(account: IAccount): Promise<Record<string, unknown>[]> {
    const rows = await withoutTenantScope('join: requests raised by this person', () =>
      JoinRequest.find({ accountId: account._id }).sort({ createdAt: -1 }).limit(20).exec()
    );
    const nameOf = await organizationNames(rows.map((row) => row.organizationId));

    return rows.map((row) => ({
      ...presentRequest(row),
      organizationName: nameOf.get(row.organizationId.toString()) ?? 'An organization',
    }));
  },

  /** Withdraws one's own pending request. */
  async cancelMyRequest(account: IAccount, requestId: string): Promise<void> {
    if (!Types.ObjectId.isValid(requestId)) throw AppError.notFound('Request not found');
    const updated = await withoutTenantScope('join: withdraw one’s own request', () =>
      JoinRequest.findOneAndUpdate(
        { _id: requestId, accountId: account._id, status: 'pending' },
        { $set: { status: 'cancelled', decidedAt: new Date() } }
      ).exec()
    );
    if (!updated) throw AppError.notFound('Request not found');
  },
};

// ─── Internals ──────────────────────────────────────────────────────────────

/**
 * Raises the request and tells the organizers. Runs the write inside the target
 * organization's scope, because the request is that tenant's row.
 */
async function raiseJoinRequest(
  code: IJoinCode,
  account: IAccount,
  organization: IOrganization,
  message?: string,
  session?: ClientSession
): Promise<Record<string, unknown>> {
  const request = await runInTenantScope(
    {
      organizationId: code.organizationId,
      userId: new Types.ObjectId(),
      role: ROLES.USER,
      permissions: [],
    },
    async () => {
      try {
        const [created] = await JoinRequest.create([{
          organizationId: code.organizationId,
          accountId: account._id,
          name: `${account.firstName} ${account.lastName ?? ''}`.trim(),
          email: account.email,
          phone: account.phone,
          joinCode: code._id,
          role: code.role,
          message,
        }], { session });
        if (!created) {
          throw new AppError('Failed to create join request', 500);
        }
        return created;
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        throw new AppError(
          'You have already asked to join this organization. An admin will answer it.',
          409,
          INVITE_ERROR.REQUEST_PENDING
        );
      }
    }
  );

  if (!request) {
    throw new AppError('Failed to create join request', 500);
  }

  await notifyOrganizers(code.organizationId, request, organization);
  return presentRequest(request);
}

/**
 * Tells every organizer that someone is waiting. Never throws: a request that
 * was raised must not fail because a notification could not be written
 * (ARCH-15).
 */
async function notifyOrganizers(
  organizationId: Types.ObjectId,
  request: IJoinRequest,
  organization: IOrganization
): Promise<void> {
  try {
    await runInTenantScope(
      { organizationId, userId: request._id, role: ROLES.USER, permissions: [] },
      async () => {
        const organizers = await User.find({ role: { $in: ORGANIZER_ROLES }, isActive: true })
          .select('_id')
          .lean();
        if (organizers.length === 0) return;

        await notificationService.notify({
          type: 'join_request_received',
          recipients: organizers.map((organizer) => organizer._id),
          // The requester is not a member, so the "actor" is named from the
          // request itself; notify() only reads the id and the name.
          actor: { userId: request._id, name: request.name, isOrganizer: false, role: ROLES.USER },
          entityId: request._id,
          subject: organization.name,
        });
      }
    );
  } catch (error) {
    logger.warn({ err: error, orgId: organizationId.toString() }, 'join request notification not sent');
  }
}

/** Creates the membership inside the target tenant and opens a session on it. */
async function createMembershipSession(
  organization: IOrganization,
  account: IAccount,
  role: Role,
  session?: ClientSession
): Promise<LoginResult> {
  await organizationService.assertCanAddUser(organization);

  const membership = await runInTenantScope(
    {
      organizationId: organization._id,
      userId: new Types.ObjectId(),
      role: ROLES.OWNER,
      permissions: ['*'],
    },
    async () => {
      const created = await memberService.addExistingAccount(organization._id, account, { role }, session);
      await Organization.updateOne(
        { _id: organization._id },
        { $inc: { 'usage.users': 1 } },
        { session }
      ).exec();
      // Re-read with the session hashes the sign-in below appends to.
      return User.findById(created._id).session(session ?? null).select('+refreshTokens').exec();
    }
  );
  if (!membership) throw AppError.internal('The new membership could not be opened.');

  // Their account sessions have served their purpose now that they are in.
  await accountSessionService.endAll(account._id);
  return authService.openMembershipSession(membership, organization);
}

async function assertNotAlreadyMember(
  organizationId: Types.ObjectId,
  accountId: Types.ObjectId,
  session?: ClientSession
): Promise<void> {
  const existing = await withoutTenantScope('join: is this person already a member?', () =>
    User.exists({ organizationId, accountId }).session(session ?? null).exec()
  );
  if (existing) {
    throw new AppError(
      'You are already a member of this organization. Sign in again to open it.',
      409,
      INVITE_ERROR.ALREADY_MEMBER
    );
  }
}

/** Organization names by id, for rows that span tenants. */
async function organizationNames(ids: Types.ObjectId[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const organizations = await withoutTenantScope('invite: name the organizations involved', () =>
    Organization.find({ _id: { $in: ids } })
      .select('name')
      .lean<Array<{ _id: Types.ObjectId; name: string }>>()
      .exec()
  );
  return new Map(organizations.map((org) => [org._id.toString(), org.name]));
}

/** A code nobody else holds. Collisions are vanishingly rare; retried anyway. */
async function uniqueJoinCode(): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_CODE; attempt += 1) {
    const candidate = generateJoinCode();
    const taken = await withoutTenantScope('invite: is this code already in use?', () =>
      JoinCode.exists({ code: candidate }).exec()
    );
    if (!taken) return candidate;
  }
  throw AppError.internal('Could not allocate an invite code.');
}

async function expireLapsedInvites(now: Date): Promise<void> {
  await OrganizationInvite.updateMany(
    { status: 'pending', expiresAt: { $lte: now } },
    { $set: { status: 'expired' } }
  );
}

function presentLink(code: IJoinCode): JoinLinkView {
  return {
    _id: code._id.toString(),
    code: formatJoinCode(code.code),
    role: code.role,
    requiresApproval: code.requiresApproval,
    expiresAt: code.expiresAt?.toISOString(),
    maxUses: code.maxUses,
    uses: code.uses,
    createdAt: code.createdAt.toISOString(),
  };
}

/** Never includes `tokenHash`: it is the invitation's credential. */
function presentInvite(invite: IOrganizationInvite): Record<string, unknown> {
  const { tokenHash: _tokenHash, ...rest } = invite.toJSON() as Record<string, unknown>;
  return rest;
}

function presentRequest(request: IJoinRequest): Record<string, unknown> {
  return request.toJSON() as Record<string, unknown>;
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;
}
