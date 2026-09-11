import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { tenantPlugin } from '../lib/tenantPlugin.js';

/**
 * A tag offered when a lead is closed as lost ("Budget mismatch", "Bought
 * elsewhere").
 *
 * Tenant data rather than a compiled list: which reasons a business tracks is
 * its own call, and an organizer changes them without a release.
 *
 * Removed outright rather than retired. A dropped lead keeps the chosen name as
 * text in `lostReason`, so nothing points at a tag's id and deleting one
 * rewrites no history. A retired row would only keep its name reserved, making
 * "already exists" the answer about a tag nobody can see.
 */
export interface ILeadDropReason extends Document {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  name: string;
  createdBy: mongoose.Types.ObjectId;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const leadDropReasonSchema = new Schema<ILeadDropReason>(
  {
    name: { type: String, required: true, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

leadDropReasonSchema.plugin(tenantPlugin);

leadDropReasonSchema.index({ organizationId: 1, name: 1 }, { unique: true });
leadDropReasonSchema.index({ organizationId: 1, sortOrder: 1, name: 1 });

export const LeadDropReason: Model<ILeadDropReason> = mongoose.model<ILeadDropReason>(
  'LeadDropReason',
  leadDropReasonSchema
);
