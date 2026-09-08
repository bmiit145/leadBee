import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { CALL_OUTCOME_ORDER, type CallOutcome } from '../config/constants.js';
import { tenantPlugin } from '../lib/tenantPlugin.js';

export interface ICallLog extends Document {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  leadId: mongoose.Types.ObjectId;
  calledBy: mongoose.Types.ObjectId;
  /** Snapshotted at write time so history stays readable after a rename or a
   *  role change — the audit value of a call log is what was true *then*. */
  calledByName: string;
  calledByRole: string;
  calledAt: Date;
  duration?: number;
  outcome: CallOutcome;
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
    calledAt: { type: Date, default: Date.now },
    duration: { type: Number, min: 0 },
    outcome: { type: String, enum: CALL_OUTCOME_ORDER, required: true },
    notes: { type: String, trim: true },
    nextFollowUpAt: { type: Date },
  },
  { timestamps: true }
);

callLogSchema.plugin(tenantPlugin);

callLogSchema.index({ organizationId: 1, leadId: 1, calledAt: -1 });
callLogSchema.index({ organizationId: 1, calledBy: 1, calledAt: -1 });

export const CallLog: Model<ICallLog> = mongoose.model<ICallLog>('CallLog', callLogSchema);
