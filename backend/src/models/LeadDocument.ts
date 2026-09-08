import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { tenantPlugin } from '../lib/tenantPlugin.js';

/**
 * A file linked to a lead. The Lead Details screen splits these into two tabs —
 * "Document" and "Attachment" — that behave identically, so `kind` discriminates
 * one collection rather than two models.
 *
 * The binary is not stored here: `url` points at wherever it lives. Direct
 * device upload needs a storage backend chosen first; until then a link is
 * captured, exactly as the reference app does.
 */
export type LeadDocumentKind = 'document' | 'attachment';

export interface ILeadDocument extends Document {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  lead: mongoose.Types.ObjectId;
  kind: LeadDocumentKind;
  name: string;
  url: string;
  mimeType?: string;
  size?: number;
  uploadedByUser: mongoose.Types.ObjectId;
  uploadedByName: string;
  createdAt: Date;
  updatedAt: Date;
}

const leadDocumentSchema = new Schema<ILeadDocument>(
  {
    lead: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
    kind: { type: String, enum: ['document', 'attachment'], required: true },
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    mimeType: { type: String, trim: true },
    size: { type: Number, min: 0 },
    uploadedByUser: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    uploadedByName: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

leadDocumentSchema.plugin(tenantPlugin);

leadDocumentSchema.index({ organizationId: 1, lead: 1, kind: 1, createdAt: -1 });

export const LeadDocument: Model<ILeadDocument> = mongoose.model<ILeadDocument>(
  'LeadDocument',
  leadDocumentSchema
);
