import type { Types } from 'mongoose';
import {
  LeadTransfer,
  type LeadTransferCloseReason,
} from '../../models/LeadTransfer.js';
import { logger } from '../../lib/logger.js';

/**
 * Closes a lead's open transfer request when something else has overtaken it —
 * an organizer reassigned the lead, or deleted it.
 *
 * Kept apart from the transfer service so the lead service can call it without
 * the two importing each other.
 *
 * Never throws. Accepting re-checks the owner anyway, so a request missed here
 * is refused with TRANSFER_STALE when someone acts on it; failing the
 * reassignment itself over this tidy-up would be the worse outcome (ARCH-15).
 */
export async function closeOpenTransfers(
  leadId: Types.ObjectId,
  reason: LeadTransferCloseReason
): Promise<void> {
  try {
    await LeadTransfer.updateMany(
      { lead: leadId, status: 'pending' },
      { $set: { status: 'cancelled', closeReason: reason, decidedAt: new Date() } }
    );
  } catch (error) {
    logger.warn({ err: error, leadId: leadId.toString(), reason }, 'open lead transfer not closed');
  }
}
