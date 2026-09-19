import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { Lead } from '../../models/Lead.js';
import { User } from '../../models/User.js';
import {
  LeadTransfer,
  type ILeadTransfer,
  type LeadTransferCloseReason,
  type LeadTransferStatus,
} from '../../models/LeadTransfer.js';
import { AppError } from '../../lib/errors.js';
import { pageParams } from '../../lib/pagination.js';
import { withOptionalTransaction } from '../../lib/transactions.js';
import { findVisibleLead, type Viewer } from '../leads/lead.service.js';
import { leadThreadService } from '../leads/leadThread.service.js';
import { notificationService } from '../notifications/notification.service.js';
import {
  TRANSFER_ERROR,
  assertMayRequestTransfer,
  effectiveStatus,
  expiryFrom,
  mayDecideTransfer,
  mayViewTransfer,
  type TransferDecision,
} from './leadTransferPolicy.js';

/** Whose requests to list. `all` is the organizer's view of the organization. */
export type TransferBox = 'received' | 'sent' | 'all';

export interface TransferFilters {
  box: TransferBox;
  status?: LeadTransferStatus;
  page?: number;
  limit?: number;
}

/** A request as a client sees it: `status` already accounts for expiry. */
export type TransferView = Record<string, unknown> & { status: LeadTransferStatus };

export interface TransferRecipient {
  _id: string;
  name: string;
  role: string;
  avatarUrl?: string;
}

interface Member {
  _id: Types.ObjectId;
  name: string;
}

type AcceptOutcome =
  | { kind: 'accepted'; transfer: ILeadTransfer }
  | { kind: 'not_pending' }
  | { kind: 'stale'; reason: LeadTransferCloseReason };

const STALE_MESSAGE: Record<LeadTransferCloseReason, string> = {
  owner_changed: 'This lead has been reassigned since the request was made, so it was closed',
  lead_removed: 'This lead has been deleted, so the request was closed',
  recipient_inactive: 'The recipient is no longer an active member, so the request was closed',
};

export const leadTransferService = {
  /**
   * Asks to hand a lead to a colleague. From an organizer it takes effect at
   * once; from the owner it waits for the recipient to accept.
   *
   * `completed` tells the client which of the two happened, so it can say
   * "transferred" or "request sent" without re-deriving the rule.
   */
  async request(
    input: { leadId: string; toUserId: string; reason?: string },
    viewer: Viewer
  ): Promise<{ transfer: TransferView; completed: boolean }> {
    const lead = await findVisibleLead(input.leadId, viewer);
    assertMayRequestTransfer(lead, input.toUserId, viewer);
    if (!lead.assignedTo) {
      // Only reachable by an organizer: nobody else can own an unowned lead.
      throw AppError.conflict('Assign this lead to someone before transferring it');
    }

    const [recipient, owner] = await Promise.all([
      activeMember(input.toUserId),
      memberName(lead.assignedTo),
    ]);

    const now = new Date();
    // A lapsed request still holds the one-open-request slot until its status
    // is written, so sweep this lead's before asking for a new one.
    await expireLapsed({ lead: lead._id }, now);

    let transfer: ILeadTransfer;
    try {
      transfer = await LeadTransfer.create({
        lead: lead._id,
        leadNumber: lead.leadNumber,
        contactName: lead.contactName,
        fromUser: lead.assignedTo,
        fromUserName: owner,
        toUser: recipient._id,
        toUserName: recipient.name,
        requestedBy: viewer.userId,
        requestedByName: viewer.name,
        ...(input.reason ? { reason: input.reason } : {}),
        status: 'pending',
        expiresAt: expiryFrom(now),
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const open = await LeadTransfer.findOne({ lead: lead._id, status: 'pending' })
        .select('_id')
        .lean();
      throw new AppError(
        'This lead already has a transfer waiting for an answer',
        409,
        TRANSFER_ERROR.PENDING,
        { transferId: open?._id.toString() }
      );
    }

    if (viewer.isOrganizer) {
      // Recorded as a request and settled by the same path an acceptance takes,
      // so the history, the owner check and the timeline are identical either way.
      const settled = await leadTransferService.decide(transfer._id.toString(), 'accept', viewer);
      return { transfer: settled, completed: true };
    }

    await Promise.all([
      leadThreadService.recordActivity(
        lead._id,
        'lead_transfer_requested',
        `${viewer.name} asked to transfer the lead to ${recipient.name}`,
        viewer,
        { transferId: transfer._id.toString(), toUser: recipient._id.toString() }
      ),
      notificationService.notify({
        type: 'lead_transfer_requested',
        recipients: [recipient._id],
        actor: viewer,
        entityId: transfer._id,
        subject: lead.contactName,
      }),
    ]);

    return { transfer: present(transfer, now), completed: false };
  },

  /**
   * Accept, decline or withdraw a pending request.
   *
   * Someone who is not a party to the request gets 404 rather than 403: whether
   * a colleague's lead is changing hands is not theirs to learn.
   */
  async decide(
    transferId: string,
    decision: TransferDecision,
    viewer: Viewer,
    note?: string
  ): Promise<TransferView> {
    const transfer = Types.ObjectId.isValid(transferId)
      ? await LeadTransfer.findById(transferId)
      : null;
    if (!transfer || !mayViewTransfer(transfer, viewer)) {
      throw AppError.notFound('Transfer request not found');
    }
    if (!mayDecideTransfer(transfer, decision, viewer)) {
      throw AppError.forbidden(
        decision === 'cancel'
          ? 'Only the sender can withdraw this request'
          : 'Only the recipient can answer this request'
      );
    }

    const now = new Date();
    if (effectiveStatus(transfer, now) !== 'pending') {
      throw await notPendingError(transfer._id, now);
    }

    return decision === 'accept'
      ? accept(transfer._id, viewer, note, now)
      : close(transfer._id, decision, viewer, note, now);
  },

  async list(
    filters: TransferFilters,
    viewer: Viewer
  ): Promise<{ data: TransferView[]; total: number; page: number; limit: number }> {
    if (filters.box === 'all' && !viewer.isOrganizer) {
      throw AppError.forbidden('Only organizers can see every transfer');
    }

    const now = new Date();
    const clauses: FilterQuery<ILeadTransfer>[] = [];
    if (filters.box === 'received') clauses.push({ toUser: viewer.userId });
    if (filters.box === 'sent') {
      // An organizer can ask on the owner's behalf; the owner still sees it.
      clauses.push({ $or: [{ requestedBy: viewer.userId }, { fromUser: viewer.userId }] });
    }
    if (filters.status) clauses.push(statusClause(filters.status, now));
    const query: FilterQuery<ILeadTransfer> = clauses.length > 0 ? { $and: clauses } : {};

    const { page, limit, skip } = pageParams(filters);
    const [rows, total] = await Promise.all([
      LeadTransfer.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      LeadTransfer.countDocuments(query),
    ]);

    return { data: rows.map((row) => present(row, now)), total, page, limit };
  },

  /** Requests waiting on the caller — the badge on "Transfer Requests". */
  async pendingCount(viewer: Viewer): Promise<number> {
    return LeadTransfer.countDocuments({
      toUser: viewer.userId,
      status: 'pending',
      expiresAt: { $gt: new Date() },
    });
  },

  /** One lead's open request, if any, and its recent transfer history. */
  async forLead(
    leadId: string,
    viewer: Viewer
  ): Promise<{ open: TransferView | null; history: TransferView[] }> {
    const lead = await findVisibleLead(leadId, viewer);
    const now = new Date();
    const rows = await LeadTransfer.find({ lead: lead._id }).sort({ createdAt: -1 }).limit(20);
    const history = rows.map((row) => present(row, now));
    return { open: history.find((row) => row.status === 'pending') ?? null, history };
  },

  /**
   * Colleagues a lead can be handed to.
   *
   * Agents have no `users.view`, so they cannot list the team; this exposes only
   * what choosing a recipient needs — name, role and picture of active members
   * of the caller's own organization — and nothing else about them.
   */
  async recipients(
    options: { search?: string; page?: number; limit?: number },
    viewer: Viewer
  ): Promise<{ data: TransferRecipient[]; total: number; page: number; limit: number }> {
    const filter: FilterQuery<Member> = { isActive: true, _id: { $ne: viewer.userId } };
    if (options.search) filter.name = { $regex: escapeRegex(options.search), $options: 'i' };

    const { page, limit, skip } = pageParams(options);
    const [rows, total] = await Promise.all([
      User.find(filter)
        .select('name role avatarUrl')
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit)
        .lean<Array<{ _id: Types.ObjectId; name: string; role: string; avatarUrl?: string }>>(),
      User.countDocuments(filter),
    ]);

    // Picked field by field: a lean read skips toJSON, and the tenant key must
    // not reach the client (BE-6).
    const data = rows.map((row) => ({
      _id: row._id.toString(),
      name: row.name,
      role: row.role,
      ...(row.avatarUrl ? { avatarUrl: row.avatarUrl } : {}),
    }));
    return { data, total, page, limit };
  },
};

/**
 * Moves the lead and records the acceptance together.
 *
 * Correct without a transaction, because every write is conditional: the claim
 * only succeeds while the request is still pending, so exactly one decision
 * wins, and the lead only moves while it is still with the owner the request
 * was made against. The transaction, where the deployment has one, adds only
 * that a crash between the two writes cannot leave one without the other.
 */
async function accept(
  transferId: Types.ObjectId,
  viewer: Viewer,
  note: string | undefined,
  now: Date
): Promise<TransferView> {
  const outcome = await withOptionalTransaction<AcceptOutcome>(async (session) => {
    const claimed = await LeadTransfer.findOneAndUpdate(
      { _id: transferId, status: 'pending', expiresAt: { $gt: now } },
      { $set: decidedFields('accepted', viewer, note, now) },
      { new: true, session }
    );
    if (!claimed) return { kind: 'not_pending' };

    const recipientActive = await User.exists({ _id: claimed.toUser, isActive: true }).session(
      session ?? null
    );
    if (!recipientActive) {
      await closeBySystem(claimed._id, 'recipient_inactive', now, session);
      return { kind: 'stale', reason: 'recipient_inactive' };
    }

    const moved = await Lead.updateOne(
      { _id: claimed.lead, isActive: true, assignedTo: claimed.fromUser },
      { $set: { assignedTo: claimed.toUser, assignedBy: claimed.requestedBy, assignedAt: now } },
      { session }
    );
    if (moved.matchedCount === 0) {
      const leadLive = await Lead.exists({ _id: claimed.lead, isActive: true }).session(
        session ?? null
      );
      const reason: LeadTransferCloseReason = leadLive ? 'owner_changed' : 'lead_removed';
      await closeBySystem(claimed._id, reason, now, session);
      return { kind: 'stale', reason };
    }

    return { kind: 'accepted', transfer: claimed };
  });

  // Closing a stale request is returned rather than thrown inside the
  // transaction, so that the close commits; the caller still hears 409.
  if (outcome.kind === 'not_pending') throw await notPendingError(transferId, now);
  if (outcome.kind === 'stale') {
    throw new AppError(STALE_MESSAGE[outcome.reason], 409, TRANSFER_ERROR.STALE, {
      closeReason: outcome.reason,
    });
  }

  const transfer = outcome.transfer;
  const byRecipient = transfer.toUser.equals(viewer.userId);
  const text = byRecipient
    ? `${transfer.toUserName} accepted the transfer from ${transfer.fromUserName}`
    : `${viewer.name} transferred the lead from ${transfer.fromUserName} to ${transfer.toUserName}`;

  await Promise.all([
    leadThreadService.recordActivity(transfer.lead, 'lead_transferred', text, viewer, {
      transferId: transfer._id.toString(),
      fromUser: transfer.fromUser.toString(),
      toUser: transfer.toUser.toString(),
    }),
    notificationService.notify({
      type: 'lead_transfer_accepted',
      recipients: [transfer.requestedBy, transfer.fromUser],
      actor: viewer,
      entityId: transfer._id,
      subject: transfer.contactName,
    }),
    // When an organizer settles it, the recipient did not agree to anything —
    // they are told the way any assignment is told.
    byRecipient
      ? Promise.resolve()
      : notificationService.notify({
          type: 'lead_assigned',
          recipients: [transfer.toUser],
          actor: viewer,
          entityId: transfer.lead,
          subject: transfer.contactName,
        }),
  ]);

  return present(transfer, now);
}

async function close(
  transferId: Types.ObjectId,
  decision: Exclude<TransferDecision, 'accept'>,
  viewer: Viewer,
  note: string | undefined,
  now: Date
): Promise<TransferView> {
  const status: LeadTransferStatus = decision === 'decline' ? 'declined' : 'cancelled';
  const updated = await LeadTransfer.findOneAndUpdate(
    { _id: transferId, status: 'pending', expiresAt: { $gt: now } },
    { $set: decidedFields(status, viewer, note, now) },
    { new: true }
  );
  if (!updated) throw await notPendingError(transferId, now);

  const declined = decision === 'decline';
  await Promise.all([
    leadThreadService.recordActivity(
      updated.lead,
      declined ? 'lead_transfer_declined' : 'lead_transfer_cancelled',
      declined
        ? `${viewer.name} declined the transfer from ${updated.fromUserName}`
        : `${viewer.name} withdrew the transfer to ${updated.toUserName}`,
      viewer,
      { transferId: updated._id.toString() }
    ),
    notificationService.notify({
      type: declined ? 'lead_transfer_declined' : 'lead_transfer_cancelled',
      recipients: declined ? [updated.requestedBy, updated.fromUser] : [updated.toUser],
      actor: viewer,
      entityId: updated._id,
      subject: updated.contactName,
    }),
  ]);

  return present(updated, now);
}

function decidedFields(
  status: LeadTransferStatus,
  viewer: Viewer,
  note: string | undefined,
  now: Date
): Record<string, unknown> {
  return {
    status,
    decidedBy: viewer.userId,
    decidedByName: viewer.name,
    decidedAt: now,
    ...(note ? { decisionNote: note } : {}),
  };
}

/** LeadBee, not a person, closed it — so no decider is recorded, only why. */
async function closeBySystem(
  transferId: Types.ObjectId,
  reason: LeadTransferCloseReason,
  now: Date,
  session: ClientSession | undefined
): Promise<void> {
  await LeadTransfer.updateOne(
    { _id: transferId },
    {
      $set: { status: 'cancelled', closeReason: reason, decidedAt: now },
      $unset: { decidedBy: 1, decidedByName: 1, decisionNote: 1 },
    },
    { session }
  );
}

/** Builds the 409 for a request that is no longer open, saying what it is now. */
async function notPendingError(transferId: Types.ObjectId, now: Date): Promise<AppError> {
  const current = await LeadTransfer.findById(transferId).select('status expiresAt');
  const status = current ? effectiveStatus(current, now) : 'cancelled';
  if (current && status === 'expired' && current.status === 'pending') {
    await expireLapsed({ _id: transferId }, now);
  }
  return new AppError(
    `This request has already been ${status}`,
    409,
    TRANSFER_ERROR.NOT_PENDING,
    { status }
  );
}

async function expireLapsed(filter: FilterQuery<ILeadTransfer>, now: Date): Promise<void> {
  await LeadTransfer.updateMany(
    { ...filter, status: 'pending', expiresAt: { $lte: now } },
    { $set: { status: 'expired' } }
  );
}

/** The filter for a status as the client sees it, lapsed-but-unswept included. */
function statusClause(status: LeadTransferStatus, now: Date): FilterQuery<ILeadTransfer> {
  if (status === 'pending') return { status: 'pending', expiresAt: { $gt: now } };
  if (status === 'expired') {
    return { $or: [{ status: 'expired' }, { status: 'pending', expiresAt: { $lte: now } }] };
  }
  return { status };
}

function present(doc: ILeadTransfer, now: Date): TransferView {
  return { ...(doc.toJSON() as Record<string, unknown>), status: effectiveStatus(doc, now) };
}

/**
 * The recipient must be an active member of this organization. The lookup is
 * tenant-scoped by the plugin, so another tenant's user id is simply not found.
 */
async function activeMember(userId: string): Promise<Member> {
  const user = Types.ObjectId.isValid(userId)
    ? await User.findOne({ _id: userId, isActive: true }).select('_id name').lean<Member>()
    : null;
  if (!user) {
    throw new AppError(
      'The recipient must be an active member of this organization',
      422,
      TRANSFER_ERROR.INVALID_RECIPIENT
    );
  }
  return user;
}

/** The owner's name for the record — they may have left since, which is fine. */
async function memberName(userId: Types.ObjectId): Promise<string> {
  const user = await User.findById(userId).select('name').lean<{ name: string }>();
  return user?.name ?? 'Former member';
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;
}

/** User input goes into a RegExp; `.` and `*` would otherwise be operators. */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
