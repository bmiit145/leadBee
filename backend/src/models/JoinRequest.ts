import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { ROLE_ORDER, type Role } from '../config/constants.js';
import { tenantPlugin } from '../lib/tenantPlugin.js';

/**
 * Someone asking to be let into an organization, after using a join code that
 * requires approval — the "New members need admin approval" setting.
 *
 * The identity is the account (ADR-0004), not a membership: the person has no
 * membership here yet, and may have none anywhere. Their name, email and mobile
 * are copied in so an admin can judge the request without a lookup across
 * tenants, and so the record still reads correctly if the account changes later.
 */
export const JOIN_REQUEST_STATUS_ORDER = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
] as const;
export type JoinRequestStatus = (typeof JOIN_REQUEST_STATUS_ORDER)[number];

export interface IJoinRequest extends Document {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  accountId: mongoose.Types.ObjectId;
  name: string;
  email: string;
  phone: string;
  /** The code they came in with, for the audit trail. */
  joinCode: mongoose.Types.ObjectId;
  /** The role they would get; the approving admin may change it. */
  role: Role;
  message?: string;
  status: JoinRequestStatus;
  decidedBy?: mongoose.Types.ObjectId;
  decidedByName?: string;
  decidedAt?: Date;
  /** The membership an approval created. */
  membership?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const joinRequestSchema = new Schema<IJoinRequest>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    joinCode: { type: Schema.Types.ObjectId, ref: 'JoinCode', required: true },
    role: { type: String, enum: ROLE_ORDER, required: true },
    message: { type: String, trim: true, maxlength: 300 },
    status: { type: String, enum: JOIN_REQUEST_STATUS_ORDER, required: true, default: 'pending' },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedByName: { type: String, trim: true },
    decidedAt: { type: Date },
    membership: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

joinRequestSchema.plugin(tenantPlugin);

// One open request per person per organization: asking twice does not queue twice.
joinRequestSchema.index(
  { organizationId: 1, accountId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);
// The admin's queue, and the badge on it.
joinRequestSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
// "Where have I asked to join?", answered without a tenant scope.
joinRequestSchema.index({ accountId: 1, status: 1, createdAt: -1 });

export const JoinRequest: Model<IJoinRequest> = mongoose.model<IJoinRequest>(
  'JoinRequest',
  joinRequestSchema
);
