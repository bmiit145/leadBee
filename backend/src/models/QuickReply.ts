import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { tenantPlugin } from '../lib/tenantPlugin.js';

/**
 * A saved canned message the agent can send over WhatsApp from the Lead Details
 * screen.
 *
 * Personal to the user who created it — the panel shows the creator's avatar on
 * each row and a per-user "Showing N quick replies" count — so the service
 * filters by `createdByUser` on top of the tenant scope.
 */
export interface IQuickReply extends Document {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  createdByUser: mongoose.Types.ObjectId;
  shortcut: string;
  message: string;
  createdAt: Date;
  updatedAt: Date;
}

const quickReplySchema = new Schema<IQuickReply>(
  {
    createdByUser: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    shortcut: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

quickReplySchema.plugin(tenantPlugin);

quickReplySchema.index({ organizationId: 1, createdByUser: 1, shortcut: 1 });
quickReplySchema.index({ organizationId: 1, createdByUser: 1, createdAt: -1 });

export const QuickReply: Model<IQuickReply> = mongoose.model<IQuickReply>(
  'QuickReply',
  quickReplySchema
);
