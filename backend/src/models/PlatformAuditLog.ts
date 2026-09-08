import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { jsonTransform } from '../lib/toJSON.js';

/**
 * Actions taken by platform staff, across tenants.
 *
 * Separate from the tenant `AuditLog` and deliberately **not** tenant-scoped: a
 * platform admin suspending an org is an act *on* a tenant, not *within* one,
 * and it must remain visible even after that org is deleted. This is the record
 * that answers "who turned this customer off, and when".
 */
export interface IPlatformAuditLog extends Document {
  _id: mongoose.Types.ObjectId;
  action: string;
  /** Target org, when the action concerns one. */
  organizationId?: mongoose.Types.ObjectId;
  organizationName?: string;
  targetType?: string;
  targetId?: mongoose.Types.ObjectId;
  adminId: mongoose.Types.ObjectId;
  adminEmail: string;
  adminRole: string;
  reason?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
}

const platformAuditLogSchema = new Schema<IPlatformAuditLog>(
  {
    action: { type: String, required: true },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
    organizationName: { type: String },
    targetType: { type: String },
    targetId: { type: Schema.Types.ObjectId },
    adminId: { type: Schema.Types.ObjectId, ref: 'PlatformAdmin', required: true },
    adminEmail: { type: String, required: true },
    adminRole: { type: String, required: true },
    reason: { type: String, trim: true },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    ip: { type: String },
    userAgent: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

platformAuditLogSchema.index({ createdAt: -1 });
platformAuditLogSchema.index({ organizationId: 1, createdAt: -1 });
platformAuditLogSchema.index({ adminId: 1, createdAt: -1 });
platformAuditLogSchema.index({ action: 1, createdAt: -1 });

platformAuditLogSchema.set('toJSON', { virtuals: true, transform: jsonTransform() });

export const PlatformAuditLog: Model<IPlatformAuditLog> = mongoose.model<IPlatformAuditLog>(
  'PlatformAuditLog',
  platformAuditLogSchema
);
