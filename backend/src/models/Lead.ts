import mongoose, { Schema, type Document, type Model } from 'mongoose';
import {
  LEAD_PRIORITY_ORDER,
  LEAD_SOURCE_ORDER,
  LEAD_STAGE_ORDER,
  type LeadPriority,
  type LeadSource,
  type LeadStage,
} from '../config/constants.js';
import { tenantPlugin } from '../lib/tenantPlugin.js';
import { tenantJsonTransform } from '../lib/toJSON.js';

/** Denormalised copy of the most recent call, so the lead list can render the
 *  last-contact line without a second query per row. */
interface LatestCallLogSnippet {
  _id: string;
  outcome: string;
  calledAt: Date;
  calledByName: string;
  notes?: string;
}

export interface ILead extends Document {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  /** `L-0001`, sequential **per organization**. */
  leadNumber: string;

  contactName: string;
  contactPhone: string;
  contactSecondPhone?: string;
  contactEmail?: string;

  source: LeadSource;
  sourceDetail?: string;
  priority: LeadPriority;
  stage: LeadStage;
  /** Why it was dropped — a drop tag's name, the agent's words, or both. */
  lostReason?: string;
  /** The organization's drop tag the reason names, when it names one — for reporting. */
  dropReason?: mongoose.Types.ObjectId;

  /** Optional grouping — a campaign, branch or product line. Purely a label for
   *  filtering; LeadBee has no inventory attached to it. */
  project?: mongoose.Types.ObjectId;

  interestedIn?: string;
  budgetMin?: number;
  budgetMax?: number;
  preferredConfig?: string;

  /** Client Details tab on the Lead Details screen. */
  address?: string;
  gstNumber?: string;

  assignedTo?: mongoose.Types.ObjectId;
  assignedBy?: mongoose.Types.ObjectId;
  assignedAt?: Date;

  lastContactedAt?: Date;
  nextFollowUpAt?: Date;
  /** Minutes before `nextFollowUpAt` to remind, one entry per reminder the user
   *  has stacked (e.g. 5 AND 120 minutes before). Mirrors Meeting. */
  reminderMinutesBefore: number[];

  /**
   * Who has bookmarked this lead. A bookmark is a person's own shortcut, so the
   * API answers `isBookmarked` for the reader and never exposes this list.
   */
  bookmarkedBy: mongoose.Types.ObjectId[];
  notes?: string;
  callCount: number;
  latestCallLog?: LatestCallLogSnippet;

  createdBy: mongoose.Types.ObjectId;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const leadSchema = new Schema<ILead>(
  {
    leadNumber: { type: String, required: true },

    contactName: { type: String, required: true, trim: true },
    contactPhone: { type: String, required: true, trim: true },
    contactSecondPhone: { type: String, trim: true },
    contactEmail: { type: String, trim: true, lowercase: true },

    source: { type: String, enum: LEAD_SOURCE_ORDER, default: 'other' },
    sourceDetail: { type: String, trim: true },
    priority: { type: String, enum: LEAD_PRIORITY_ORDER, default: 'warm' },
    stage: { type: String, enum: LEAD_STAGE_ORDER, default: 'new' },
    lostReason: { type: String, trim: true },
    dropReason: { type: Schema.Types.ObjectId, ref: 'LeadDropReason' },

    project: { type: Schema.Types.ObjectId, ref: 'Project' },

    interestedIn: { type: String, trim: true },
    budgetMin: { type: Number },
    budgetMax: { type: Number },
    preferredConfig: { type: String, trim: true },

    address: { type: String, trim: true },
    gstNumber: { type: String, trim: true },

    assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    assignedAt: { type: Date },

    lastContactedAt: { type: Date },
    nextFollowUpAt: { type: Date },
    reminderMinutesBefore: { type: [Number], default: [] },

    bookmarkedBy: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    notes: { type: String, trim: true },
    callCount: { type: Number, default: 0 },
    latestCallLog: {
      _id: String,
      outcome: String,
      calledAt: Date,
      calledByName: String,
      notes: String,
    },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

leadSchema.plugin(tenantPlugin);

// ─── Indexes ─────────────────────────────────────────────────────────────────
// Every one leads with organizationId: it is the most selective predicate on a
// shared collection, and it keeps queries single-shard once organizationId
// becomes the shard key. See docs/MULTI-TENANCY.md.

// Per-tenant lead numbering. Global uniqueness would let one tenant's L-0001
// block another's.
leadSchema.index({ organizationId: 1, leadNumber: 1 }, { unique: true });

// The default list: an agent's own leads, filtered by stage.
leadSchema.index({ organizationId: 1, assignedTo: 1, stage: 1, createdAt: -1 });
// An organizer's list: everything in the org, newest first.
leadSchema.index({ organizationId: 1, isActive: 1, createdAt: -1 });
// Stage/priority filter tabs.
leadSchema.index({ organizationId: 1, stage: 1, priority: 1 });
// Purpose of Inquiry filter.
leadSchema.index({ organizationId: 1, interestedIn: 1, createdAt: -1 });
// Reminder screen (today / tomorrow / overdue) and the overdue badge.
leadSchema.index({ organizationId: 1, nextFollowUpAt: 1, stage: 1 });
// Bookmarks screen: one person's bookmarks, newest first (multikey on bookmarkedBy).
leadSchema.index({ organizationId: 1, bookmarkedBy: 1, createdAt: -1 });
// Duplicate detection on intake.
leadSchema.index({ organizationId: 1, contactPhone: 1 });
leadSchema.index({ organizationId: 1, createdBy: 1, createdAt: -1 });

leadSchema.set('toJSON', { virtuals: true, transform: tenantJsonTransform() });

export const Lead: Model<ILead> = mongoose.model<ILead>('Lead', leadSchema);
