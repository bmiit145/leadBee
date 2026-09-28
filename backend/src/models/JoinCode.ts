import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { ROLE_ORDER, ROLES, type Role } from '../config/constants.js';
import { tenantPlugin } from '../lib/tenantPlugin.js';

/**
 * The organization's shareable invite link, as WhatsApp has one per group.
 *
 * One active code per organization: an admin shares it, and "reset" retires it
 * and issues another — which is the whole point, because the old link then
 * stops working everywhere it was forwarded.
 *
 * The code is stored as typed rather than hashed, because an admin must be able
 * to re-read and re-share it. It is a shareable secret, like a WhatsApp group
 * link, so the protection is elsewhere: approval on by default, an expiry, a
 * use limit, one-tap reset, and rate limits on redemption. A targeted email
 * invitation (`OrganizationInvite`) is the stronger door and is hashed.
 * See docs/adr/0007-joining-an-organization.md.
 */
export interface IJoinCode extends Document {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  /** Typed by the joiner. Unambiguous alphabet, stored and compared uppercase. */
  code: string;
  /** The role someone gets by joining with it. Never an organizer role. */
  role: Role;
  /**
   * When true, using the code raises a request an admin answers. Default, and
   * the only safe default for a link that can be forwarded.
   */
  requiresApproval: boolean;
  expiresAt?: Date;
  /** Most times it may be used. Absent is unlimited. */
  maxUses?: number;
  uses: number;
  isActive: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdByName: string;
  revokedAt?: Date;
  revokedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const joinCodeSchema = new Schema<IJoinCode>(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    role: { type: String, enum: ROLE_ORDER, required: true, default: ROLES.USER },
    requiresApproval: { type: Boolean, required: true, default: true },
    expiresAt: { type: Date },
    maxUses: { type: Number, min: 1 },
    uses: { type: Number, required: true, default: 0, min: 0 },
    isActive: { type: Boolean, required: true, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true, trim: true },
    revokedAt: { type: Date },
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

joinCodeSchema.plugin(tenantPlugin);

// Redemption arrives with a code and no tenant yet, so the lookup is by code
// alone and must be unique across every organization. A single-field index, so
// it does not fall under the compound-index rule (ARCH-5).
joinCodeSchema.index({ code: 1 }, { unique: true });
// One active link per organization — "reset" retires the old one. Keyed on
// `isActive` as well as the tenant, because the plugin already declares a plain
// `{ organizationId: 1 }` index and two indexes cannot share a name.
joinCodeSchema.index(
  { organizationId: 1, isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);
// The organization's link history, newest first.
joinCodeSchema.index({ organizationId: 1, createdAt: -1 });

export const JoinCode: Model<IJoinCode> = mongoose.model<IJoinCode>('JoinCode', joinCodeSchema);
