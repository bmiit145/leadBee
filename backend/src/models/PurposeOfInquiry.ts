import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { tenantPlugin } from '../lib/tenantPlugin.js';

/**
 * A reusable "why is this meeting happening" label, picked from a dropdown when
 * scheduling. Tenant-defined, so each customer's vocabulary is their own.
 */
export interface IPurposeOfInquiry extends Document {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  name: string;
  createdBy: mongoose.Types.ObjectId;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const purposeSchema = new Schema<IPurposeOfInquiry>(
  {
    name: { type: String, required: true, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

purposeSchema.plugin(tenantPlugin);

purposeSchema.index({ organizationId: 1, name: 1 }, { unique: true });
purposeSchema.index({ organizationId: 1, isActive: 1, sortOrder: 1 });

export const PurposeOfInquiry: Model<IPurposeOfInquiry> = mongoose.model<IPurposeOfInquiry>(
  'PurposeOfInquiry',
  purposeSchema
);
