import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { CALL_OUTCOME_ORDER, type CallOutcome } from '../config/constants.js';
import { tenantPlugin } from '../lib/tenantPlugin.js';

/** How the record came to exist. `manual` rows predate automatic tracking. */
export const CALL_SOURCE_ORDER = ['app', 'device', 'manual'] as const;
export type CallSource = (typeof CALL_SOURCE_ORDER)[number];

export const CALL_DIRECTION_ORDER = ['outgoing', 'incoming', 'missed', 'rejected'] as const;
export type CallDirection = (typeof CALL_DIRECTION_ORDER)[number];

export interface ICallLog extends Document {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  leadId: mongoose.Types.ObjectId;
  calledBy: mongoose.Types.ObjectId;
  /**
   * `app` — placed from inside LeadBee, the only kind a Play build can measure.
   * `device` — read from the phone's call log (internal builds only).
   * `manual` — typed in before automatic tracking; kept, never written again.
   */
  source: CallSource;
  direction: CallDirection;
  /** The phone's own id for a device call log entry — the idempotency key for sync. */
  deviceCallId?: string;
  /** As dialled, digits only with country code, so it can be matched to a lead. */
  phoneNumber?: string;
  /** Snapshotted at write time so history stays readable after a rename or a
   *  role change — the audit value of a call log is what was true *then*. */
  calledByName: string;
  calledByRole: string;
  calledAt: Date;
  /** Seconds for a measured call; the minutes typed into old manual rows. */
  duration?: number;
  /** A person's reading of the call. A measured call has none until someone sets one. */
  outcome?: CallOutcome;
  notes?: string;
  nextFollowUpAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const callLogSchema = new Schema<ICallLog>(
  {
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
    calledBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    calledByName: { type: String, required: true, trim: true },
    calledByRole: { type: String, required: true },
    source: { type: String, enum: CALL_SOURCE_ORDER, required: true, default: 'app' },
    direction: { type: String, enum: CALL_DIRECTION_ORDER, required: true, default: 'outgoing' },
    deviceCallId: { type: String, trim: true },
    phoneNumber: { type: String, trim: true },
    calledAt: { type: Date, default: Date.now },
    duration: { type: Number, min: 0 },
    outcome: { type: String, enum: CALL_OUTCOME_ORDER },
    notes: { type: String, trim: true },
    nextFollowUpAt: { type: Date },
  },
  { timestamps: true }
);

callLogSchema.plugin(tenantPlugin);

callLogSchema.index({ organizationId: 1, leadId: 1, calledAt: -1 });
callLogSchema.index({ organizationId: 1, calledBy: 1, calledAt: -1 });
// The whole organization's calls by day — the Call Tracking list and its counters.
callLogSchema.index({ organizationId: 1, calledAt: -1 });
// Re-syncing a window must not duplicate: one row per phone call log entry, per member.
callLogSchema.index(
  { organizationId: 1, calledBy: 1, deviceCallId: 1 },
  { unique: true, partialFilterExpression: { deviceCallId: { $type: 'string' } } }
);

export const CallLog: Model<ICallLog> = mongoose.model<ICallLog>('CallLog', callLogSchema);
