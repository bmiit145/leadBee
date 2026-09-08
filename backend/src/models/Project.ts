import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { tenantPlugin } from '../lib/tenantPlugin.js';

/**
 * A grouping label for leads — a campaign, branch, product line or intake batch.
 *
 * This is the generic remnant of what was a real-estate "project" in the
 * reference app. LeadBee keeps the grouping (the lead list filters by it, and
 * the filter chips on the mobile list read from here) but nothing hangs off it:
 * no inventory, no units, no pricing.
 */
export interface IProject extends Document {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  color?: string;
  isActive: boolean;
  sortOrder: number;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const projectSchema = new Schema<IProject>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    color: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

projectSchema.plugin(tenantPlugin);

projectSchema.index({ organizationId: 1, name: 1 }, { unique: true });
projectSchema.index({ organizationId: 1, isActive: 1, sortOrder: 1 });

export const Project: Model<IProject> = mongoose.model<IProject>('Project', projectSchema);
