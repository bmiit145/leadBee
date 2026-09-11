import { Types } from 'mongoose';
import {
  LeadThreadItem,
  type ILeadThreadItem,
  type LeadThreadChannel,
} from '../../models/LeadThreadItem.js';
import {
  LeadDocument,
  type ILeadDocument,
  type LeadDocumentKind,
} from '../../models/LeadDocument.js';
import { Lead } from '../../models/Lead.js';
import { AppError } from '../../lib/errors.js';
import { pageParams } from '../../lib/pagination.js';
import type { Viewer } from './lead.service.js';

/**
 * The three thread channels ("Time Line", "Notes", "Ask Query") and the two
 * document tabs on the Lead Details screen.
 *
 * Every operation re-checks access to the parent lead first. Reaching a thread
 * entry by its own id must not be a way around the lead's own visibility rule.
 */

/** User input goes into a RegExp; `.` and `*` would otherwise be operators. */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Throws 404 if the lead is not in this tenant, 403 if it is not this agent's. */
async function assertLeadAccess(leadId: string, viewer: Viewer): Promise<void> {
  const lead = await Lead.findOne({ _id: leadId, isActive: true }).select(
    'assignedTo createdBy'
  );
  if (!lead) throw AppError.notFound('Lead not found');
  if (viewer.isOrganizer) return;

  const uid = viewer.userId.toString();
  const isOwner =
    lead.assignedTo?.toString() === uid || lead.createdBy?.toString() === uid;
  if (!isOwner) throw AppError.forbidden('Access denied');
}

/** Authors may edit and delete their own entries; organizers, anyone's. */
function assertCanMutate(
  ownerId: Types.ObjectId,
  viewer: Viewer,
  verb: 'edit' | 'delete'
): void {
  if (viewer.isOrganizer) return;
  if (ownerId.toString() !== viewer.userId.toString()) {
    throw AppError.forbidden(`You can only ${verb} your own entries`);
  }
}

export const leadThreadService = {
  async list(
    leadId: string,
    channel: LeadThreadChannel,
    viewer: Viewer,
    options: { page?: number; limit?: number; resolved?: boolean } = {}
  ) {
    await assertLeadAccess(leadId, viewer);

    const filter: Record<string, unknown> = {
      lead: new Types.ObjectId(leadId),
      channel,
    };
    if (options.resolved !== undefined) filter.resolved = options.resolved;

    const { page, limit, skip } = pageParams({
      page: options.page,
      limit: options.limit ?? 30,
    });

    const [data, total] = await Promise.all([
      LeadThreadItem.find(filter)
        .populate('createdByUser', 'name role avatarUrl')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      LeadThreadItem.countDocuments(filter),
    ]);

    return { data, total, page, limit };
  },

  async create(
    leadId: string,
    channel: LeadThreadChannel,
    text: string,
    viewer: Viewer
  ): Promise<ILeadThreadItem> {
    await assertLeadAccess(leadId, viewer);
    return LeadThreadItem.create({
      lead: new Types.ObjectId(leadId),
      channel,
      text,
      createdByUser: viewer.userId,
      createdByName: viewer.name,
    });
  },

  async update(
    leadId: string,
    itemId: string,
    text: string,
    viewer: Viewer
  ): Promise<ILeadThreadItem> {
    await assertLeadAccess(leadId, viewer);
    const item = await LeadThreadItem.findOne({
      _id: itemId,
      lead: new Types.ObjectId(leadId),
    });
    if (!item) throw AppError.notFound('Thread item not found');

    assertCanMutate(item.createdByUser, viewer, 'edit');
    item.text = text;
    item.editedAt = new Date();
    await item.save();
    return item;
  },

  /** Only meaningful on the `query` channel — the Ask Query tab's resolve tick. */
  async toggleResolved(
    leadId: string,
    itemId: string,
    viewer: Viewer
  ): Promise<ILeadThreadItem> {
    await assertLeadAccess(leadId, viewer);
    const item = await LeadThreadItem.findOne({
      _id: itemId,
      lead: new Types.ObjectId(leadId),
    });
    if (!item) throw AppError.notFound('Thread item not found');

    item.resolved = !item.resolved;
    await item.save();
    return item;
  },

  async remove(leadId: string, itemId: string, viewer: Viewer): Promise<void> {
    await assertLeadAccess(leadId, viewer);
    const item = await LeadThreadItem.findOne({
      _id: itemId,
      lead: new Types.ObjectId(leadId),
    });
    if (!item) throw AppError.notFound('Thread item not found');

    assertCanMutate(item.createdByUser, viewer, 'delete');
    await item.deleteOne();
  },

  // ─── Documents / Attachments ────────────────────────────────────────────────

  async listDocuments(
    leadId: string,
    viewer: Viewer,
    options: { kind?: LeadDocumentKind; page?: number; limit?: number } = {}
  ) {
    await assertLeadAccess(leadId, viewer);

    const filter: Record<string, unknown> = { lead: new Types.ObjectId(leadId) };
    if (options.kind) filter.kind = options.kind;

    const { page, limit, skip } = pageParams({
      page: options.page,
      limit: options.limit ?? 50,
    });

    const [data, total] = await Promise.all([
      LeadDocument.find(filter)
        .populate('uploadedByUser', 'name role avatarUrl')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      LeadDocument.countDocuments(filter),
    ]);

    return { data, total, page, limit };
  },

  /**
   * Every document and attachment the viewer can reach — the drawer's Document
   * screen.
   *
   * An agent's reach is their own book, so their visible lead ids are resolved
   * first; that set is bounded by what one person works. An organizer skips the
   * lookup: on a large organization it would be tens of thousands of ids that
   * narrow nothing. Files on a soft-deleted lead therefore still list for an
   * organizer, marked by the populated lead's `isActive`, rather than silently
   * dropping out of a page and skewing its count.
   */
  async listLibrary(
    viewer: Viewer,
    options: { kind?: LeadDocumentKind; search?: string; page?: number; limit?: number } = {}
  ) {
    const filter: Record<string, unknown> = {};
    if (!viewer.isOrganizer) {
      const leadIds = await Lead.distinct('_id', {
        isActive: true,
        $or: [{ assignedTo: viewer.userId }, { createdBy: viewer.userId }],
      });
      filter.lead = { $in: leadIds };
    }
    if (options.kind) filter.kind = options.kind;
    if (options.search) filter.name = new RegExp(escapeRegex(options.search), 'i');

    const { page, limit, skip } = pageParams(options);
    const [rows, total] = await Promise.all([
      LeadDocument.find(filter)
        .populate('lead', 'leadNumber contactName contactPhone isActive')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      LeadDocument.countDocuments(filter),
    ]);

    return { data: rows.map((row) => row.toJSON()), total, page, limit };
  },

  async addDocument(
    leadId: string,
    payload: {
      kind: LeadDocumentKind;
      name: string;
      url: string;
      mimeType?: string;
      size?: number;
    },
    viewer: Viewer
  ): Promise<ILeadDocument> {
    await assertLeadAccess(leadId, viewer);
    return LeadDocument.create({
      lead: new Types.ObjectId(leadId),
      ...payload,
      uploadedByUser: viewer.userId,
      uploadedByName: viewer.name,
    });
  },

  async removeDocument(leadId: string, docId: string, viewer: Viewer): Promise<void> {
    await assertLeadAccess(leadId, viewer);
    const doc = await LeadDocument.findOne({
      _id: docId,
      lead: new Types.ObjectId(leadId),
    });
    if (!doc) throw AppError.notFound('Document not found');

    assertCanMutate(doc.uploadedByUser, viewer, 'delete');
    await doc.deleteOne();
  },
};
