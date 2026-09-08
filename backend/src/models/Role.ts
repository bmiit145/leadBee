import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { tenantPlugin } from '../lib/tenantPlugin.js';

/**
 * A named permission set inside one organization.
 *
 * Tenant-scoped so each customer can define their own roles ("Site Head",
 * "Tele-caller") without those names appearing in anyone else's list.
 */
export interface IRole extends Document {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  permissions: string[];
  /** Seeded roles cannot be deleted — removing them would strand their users. */
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const roleSchema = new Schema<IRole>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    permissions: { type: [String], default: [] },
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true }
);

roleSchema.plugin(tenantPlugin);

roleSchema.index({ organizationId: 1, name: 1 }, { unique: true });

export const Role: Model<IRole> = mongoose.model<IRole>('Role', roleSchema);
