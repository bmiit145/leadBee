import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { tenantPlugin } from '../lib/tenantPlugin.js';

/**
 * A request to hand a lead from its owner to a colleague, and what became of it.
 *
 * The request *is* the audit record: who asked, why, who decided and when are
 * kept on it for good, rather than inferred later from the lead's current
 * `assignedTo`. See docs/adr/0006-lead-transfer.md.
 *
 * Names are snapshotted at write time, as call logs do, so the history still
 * reads correctly after someone is renamed or leaves the organization.
 */
export const LEAD_TRANSFER_STATUS_ORDER = [
  'pending',
  'accepted',
  'declined',
  'cancelled',
  'expired',
] as const;
export type LeadTransferStatus = (typeof LEAD_TRANSFER_STATUS_ORDER)[number];

/**
 * Why LeadBee closed a request nobody decided. Set only with `cancelled` when the
 * system, not a person, closed it.
 *
 * `owner_changed` — the lead was reassigned some other way while this was open.
 * `lead_removed` — the lead was deleted.
 * `recipient_inactive` — the recipient left the organization before accepting.
 */
export const LEAD_TRANSFER_CLOSE_REASONS = [
  'owner_changed',
  'lead_removed',
  'recipient_inactive',
] as const;
export type LeadTransferCloseReason = (typeof LEAD_TRANSFER_CLOSE_REASONS)[number];

export interface ILeadTransfer extends Document {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  lead: mongoose.Types.ObjectId;
  leadNumber: string;
  contactName: string;
  /** The owner when the request was made. Accepting is refused if that has since changed. */
  fromUser: mongoose.Types.ObjectId;
  fromUserName: string;
  toUser: mongoose.Types.ObjectId;
  toUserName: string;
  /** The owner, or an organizer acting for them. */
  requestedBy: mongoose.Types.ObjectId;
  requestedByName: string;
  /** Optional: a hand-off between colleagues often needs no explanation. */
  reason?: string;
  status: LeadTransferStatus;
  decidedBy?: mongoose.Types.ObjectId;
  decidedByName?: string;
  decidedAt?: Date;
  decisionNote?: string;
  closeReason?: LeadTransferCloseReason;
  /** A pending request past this is treated as expired, whether or not it has been swept yet. */
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const leadTransferSchema = new Schema<ILeadTransfer>(
  {
    lead: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
    leadNumber: { type: String, required: true, trim: true },
    contactName: { type: String, required: true, trim: true },
    fromUser: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    fromUserName: { type: String, required: true, trim: true },
    toUser: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    toUserName: { type: String, required: true, trim: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    requestedByName: { type: String, required: true, trim: true },
    reason: { type: String, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: LEAD_TRANSFER_STATUS_ORDER,
      required: true,
      default: 'pending',
    },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedByName: { type: String, trim: true },
    decidedAt: { type: Date },
    decisionNote: { type: String, trim: true, maxlength: 500 },
    closeReason: { type: String, enum: LEAD_TRANSFER_CLOSE_REASONS },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

leadTransferSchema.plugin(tenantPlugin);

// One open request per lead. Enforced here rather than by a read-then-write in
// the service, which two taps a moment apart would both pass.
leadTransferSchema.index(
  { organizationId: 1, lead: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);
// A lead's transfer history, newest first.
leadTransferSchema.index({ organizationId: 1, lead: 1, createdAt: -1 });
// Received: what is waiting on me — and its badge.
leadTransferSchema.index({ organizationId: 1, toUser: 1, status: 1, createdAt: -1 });
// Sent: what I asked for, and what an organizer asked for on my behalf.
leadTransferSchema.index({ organizationId: 1, requestedBy: 1, createdAt: -1 });
leadTransferSchema.index({ organizationId: 1, fromUser: 1, createdAt: -1 });
// Organizer overview across the organization.
leadTransferSchema.index({ organizationId: 1, status: 1, createdAt: -1 });

export const LeadTransfer: Model<ILeadTransfer> = mongoose.model<ILeadTransfer>(
  'LeadTransfer',
  leadTransferSchema
);
