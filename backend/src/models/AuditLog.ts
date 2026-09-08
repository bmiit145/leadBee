import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { tenantPlugin } from '../lib/tenantPlugin.js';
import type { AuditAction } from '../config/constants.js';

/**
 * Who changed what, inside one tenant.
 *
 * Actor name and role are snapshotted rather than referenced: an audit trail
 * that renders differently after someone is renamed or demoted is not an audit
 * trail. `before`/`after` hold only the fields that actually changed.
 */
export interface IAuditLog extends Document {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  action: AuditAction | string;
  entityType: string;
  entityId: mongoose.Types.ObjectId;
  actorId: mongoose.Types.ObjectId;
  actorName: string;
  actorRole: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorName: { type: String, required: true },
    actorRole: { type: String, required: true },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    ip: { type: String },
    userAgent: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.plugin(tenantPlugin);

auditLogSchema.index({ organizationId: 1, entityType: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ organizationId: 1, actorId: 1, createdAt: -1 });
auditLogSchema.index({ organizationId: 1, createdAt: -1 });

// Audit rows are append-only and voluminous. A TTL keeps the collection from
// becoming the largest thing in the cluster; enterprise tenants who need longer
// retention get their rows shipped to cold storage by a nightly export instead
// of by raising this number.
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 });

export const AuditLog: Model<IAuditLog> = mongoose.model<IAuditLog>('AuditLog', auditLogSchema);
