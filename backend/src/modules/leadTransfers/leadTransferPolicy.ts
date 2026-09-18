import { AppError } from '../../lib/errors.js';
import { isSelf, type Actor } from '../work/workAccess.js';
import type { LeadTransferStatus } from '../../models/LeadTransfer.js';

/**
 * The rules of a lead transfer, kept pure so each is tested once rather than
 * re-derived at every call site.
 *
 * | Who | Request | Accept / decline | Cancel | See |
 * | --- | --- | --- | --- | --- |
 * | Lead owner | their own leads | — | their requests | theirs |
 * | Recipient | — | requests to them | — | theirs |
 * | Organizer | any lead, applied at once | any pending | any pending | all |
 *
 * An organizer's request needs nobody's consent: handing out work is what the
 * role is for, and it is already what PUT /leads/:id/assign does. An owner's
 * request waits for the recipient, because nobody should find a colleague's
 * customers in their book without having agreed to take them.
 */

/** How long a request waits for an answer before it lapses. */
export const TRANSFER_EXPIRY_DAYS = 7;

/** Stable `error.code`s. Clients branch on these (ENG-6). */
export const TRANSFER_ERROR = {
  /** The lead already has an open request. `details.transferId` names it. */
  PENDING: 'TRANSFER_PENDING',
  /** It has already been decided, withdrawn, or has lapsed. `details.status` says which. */
  NOT_PENDING: 'TRANSFER_NOT_PENDING',
  /** The lead or the recipient changed underneath it; LeadBee has closed it. */
  STALE: 'TRANSFER_STALE',
  /** The recipient is the current owner, or not an active member. */
  INVALID_RECIPIENT: 'TRANSFER_INVALID_RECIPIENT',
} as const;

export type TransferDecision = 'accept' | 'decline' | 'cancel';

interface TransferParties {
  fromUser: unknown;
  toUser: unknown;
  requestedBy: unknown;
}

export function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + TRANSFER_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * A pending request past its expiry reads as expired straight away. The stored
 * status catches up when the request is next written, so no scheduler is needed
 * for the answer to be right.
 */
export function effectiveStatus(
  transfer: { status: LeadTransferStatus; expiresAt: Date },
  now: Date
): LeadTransferStatus {
  return transfer.status === 'pending' && transfer.expiresAt.getTime() <= now.getTime()
    ? 'expired'
    : transfer.status;
}

/** Throws 403 when the actor may not hand this lead on, 422 for a pointless recipient. */
export function assertMayRequestTransfer(
  lead: { assignedTo?: unknown },
  recipientId: string,
  actor: Actor
): void {
  if (!actor.isOrganizer && !isSelf(lead.assignedTo, actor)) {
    throw AppError.forbidden('Only the lead’s owner or an organizer can transfer it');
  }
  if (isSelf(lead.assignedTo, { userId: recipientId, isOrganizer: false })) {
    throw new AppError(
      'This lead is already assigned to them',
      422,
      TRANSFER_ERROR.INVALID_RECIPIENT
    );
  }
}

export function mayViewTransfer(transfer: TransferParties, actor: Actor): boolean {
  return (
    actor.isOrganizer ||
    isSelf(transfer.toUser, actor) ||
    isSelf(transfer.fromUser, actor) ||
    isSelf(transfer.requestedBy, actor)
  );
}

/**
 * Accepting and declining belong to the recipient; withdrawing belongs to
 * whoever is giving the lead away. Neither side can make the other's decision,
 * so a sender cannot accept on the recipient's behalf.
 */
export function mayDecideTransfer(
  transfer: TransferParties,
  decision: TransferDecision,
  actor: Actor
): boolean {
  if (actor.isOrganizer) return true;
  if (decision === 'cancel') {
    return isSelf(transfer.requestedBy, actor) || isSelf(transfer.fromUser, actor);
  }
  return isSelf(transfer.toUser, actor);
}
