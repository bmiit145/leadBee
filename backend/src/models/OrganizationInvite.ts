import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { ROLE_ORDER, ROLES, type Role } from '../config/constants.js';
import { tenantPlugin } from '../lib/tenantPlugin.js';

/**
 * An invitation addressed to one person, by email.
 *
 * The strongest of the ways in: the token is single-use, expires, and is
 * accepted only by someone signed in with that exact email — a forwarded link
 * gets the forwarder nothing. Only the SHA-256 of the token is stored, so a
 * copy of the database does not yield a working invitation, exactly as refresh
 * tokens are kept (ENG-23).
 */
export const INVITE_STATUS_ORDER = ['pending', 'accepted', 'revoked', 'expired'] as const;
export type InviteStatus = (typeof INVITE_STATUS_ORDER)[number];

export interface IOrganizationInvite extends Document {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  /** Lowercased. The only address that may accept. */
  email: string;
  /** Optional, for sending the link over SMS or WhatsApp instead. */
  phone?: string;
  role: Role;
  tokenHash: string;
  /** A line from the admin, shown with the invitation. */
  message?: string;
  status: InviteStatus;
  expiresAt: Date;
  invitedBy: mongoose.Types.ObjectId;
  invitedByName: string;
  acceptedAt?: Date;
  /** The membership the acceptance created. */
  acceptedBy?: mongoose.Types.ObjectId;
  revokedAt?: Date;
  revokedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const organizationInviteSchema = new Schema<IOrganizationInvite>(
  {
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    phone: { type: String, trim: true },
    role: { type: String, enum: ROLE_ORDER, required: true, default: ROLES.USER },
    tokenHash: { type: String, required: true },
    message: { type: String, trim: true, maxlength: 300 },
    status: { type: String, enum: INVITE_STATUS_ORDER, required: true, default: 'pending' },
    expiresAt: { type: Date, required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    invitedByName: { type: String, required: true, trim: true },
    acceptedAt: { type: Date },
    acceptedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    revokedAt: { type: Date },
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

organizationInviteSchema.plugin(tenantPlugin);

// Acceptance arrives with a token and no tenant yet — looked up by hash alone.
organizationInviteSchema.index({ tokenHash: 1 }, { unique: true });
// One open invitation per address per organization, so re-inviting cannot pile
// up live tokens for the same person.
organizationInviteSchema.index(
  { organizationId: 1, email: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);
// The admin's list of invitations, newest first.
organizationInviteSchema.index({ organizationId: 1, status: 1, createdAt: -1 });

export const OrganizationInvite: Model<IOrganizationInvite> = mongoose.model<IOrganizationInvite>(
  'OrganizationInvite',
  organizationInviteSchema
);
