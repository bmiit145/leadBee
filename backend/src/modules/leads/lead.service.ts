import { Types, type FilterQuery } from 'mongoose';
import { Lead, type ILead } from '../../models/Lead.js';
import { CallLog } from '../../models/CallLog.js';
import { Organization } from '../../models/Organization.js';
import { User } from '../../models/User.js';
import { Task } from '../../models/Task.js';
import { Meeting } from '../../models/Meeting.js';
import { LeadDropReason } from '../../models/LeadDropReason.js';
import { AppError } from '../../lib/errors.js';
import { nextDisplayNumber } from '../../lib/counters.js';
import { pageParams } from '../../lib/pagination.js';
import { requireOrganizationId } from '../../lib/tenantContext.js';
import { addDays, calendarDayOf, dayBounds, dayRange } from '../../lib/zonedTime.js';
import { zoneOf } from '../../lib/viewer.js';
import { notificationService } from '../notifications/notification.service.js';
import { canSeeLead } from '../work/workAccess.js';
import { leadThreadService } from './leadThread.service.js';
import {
  LEAD_STAGE_ORDER,
  TERMINAL_LEAD_STAGES,
  VALID_LEAD_STAGE_TRANSITIONS,
  type LeadPriority,
  type LeadStage,
} from '../../config/constants.js';

/**
 * Who is asking.
 *
 * An **organizer** sees every lead in the organization; everyone else sees only
 * what is assigned to or created by them. The distinction is computed once, in
 * the auth plugin, rather than re-derived from role strings in each service.
 */
export interface Viewer {
  userId: Types.ObjectId;
  isOrganizer: boolean;
  name: string;
  role: string;
  /** IANA zone the caller works in, for "today", "tomorrow" and date filters. */
  timeZone?: string;
}

export interface LeadFilters {
  stage?: string;
  priority?: string;
  source?: string;
  assignedTo?: string;
  project?: string;
  /** Purpose of Inquiry, matched exactly — the form stores the picked name. */
  interestedIn?: string;
  search?: string;
  page?: number;
  limit?: number;
  overdueFollowUp?: boolean;
  reminderScope?: 'today' | 'tomorrow' | 'overdue';
  bookmarked?: boolean;
  dateFrom?: string;
  dateTo?: string;
  budgetMin?: number;
  budgetMax?: number;
  /** Organizers only: soft-deleted leads. */
  deleted?: boolean;
}

/** A lead as one reader sees it: `isBookmarked` is theirs alone. */
export type LeadView = Record<string, unknown> & { isBookmarked: boolean };

const POPULATE_LIST = [
  { path: 'assignedTo', select: 'name phone role avatarUrl' },
  { path: 'createdBy', select: 'name role avatarUrl' },
  { path: 'project', select: 'name color' },
] as const;

const POPULATE_DETAIL = [
  { path: 'assignedTo', select: 'name phone role avatarUrl' },
  { path: 'assignedBy', select: 'name role' },
  { path: 'createdBy', select: 'name role avatarUrl' },
  { path: 'project', select: 'name color' },
] as const;

/** "follow_up" → "Follow Up", for activity text. */
const stageLabel = (stage: string) =>
  stage
    .split('_')
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');

/**
 * Replaces the stored `bookmarkedBy` list with the reader's own `isBookmarked`.
 * Who else bookmarked a lead is nobody's business, and the list grows with the team.
 */
export function presentLead(
  lead: Record<string, unknown>,
  viewer: Pick<Viewer, 'userId'>
): LeadView {
  const { bookmarkedBy, isBookmarked: _legacy, ...rest } = lead;
  const uid = viewer.userId.toString();
  const marked = Array.isArray(bookmarkedBy)
    ? bookmarkedBy.some((id) => String(id) === uid)
    : false;
  return { ...rest, isBookmarked: marked };
}

function presentDoc(lead: ILead, viewer: Viewer): LeadView {
  return presentLead(lead.toJSON() as Record<string, unknown>, viewer);
}

/** Throws 404 when the lead does not exist (or is deleted), 403 when it is not this agent's. */
export async function findVisibleLead(
  leadId: string | Types.ObjectId,
  viewer: Viewer
): Promise<ILead> {
  if (!Types.ObjectId.isValid(String(leadId))) throw AppError.notFound('Lead not found');
  const lead = await Lead.findOne({ _id: leadId, isActive: true });
  if (!lead) throw AppError.notFound('Lead not found');
  if (!canSeeLead(lead, viewer)) throw AppError.forbidden('Access denied');
  return lead;
}

export async function leadIsVisible(
  leadId: string | Types.ObjectId,
  viewer: Viewer
): Promise<boolean> {
  if (!Types.ObjectId.isValid(String(leadId))) return false;
  const lead = await Lead.findOne({ _id: leadId, isActive: true })
    .select('assignedTo createdBy')
    .lean();
  return !!lead && canSeeLead(lead, viewer);
}

export const leadService = {
  /**
   * Handing a new lead to someone else *is* assignment, so it follows the same
   * rule as PUT /leads/:id/assign: organizers only.
   *
   * Split out of `create` so the route can run it before the plan-limit check.
   * A tenant at its lead limit must still hear "not allowed" rather than
   * "upgrade your plan" — denied and degraded are different answers, and a
   * refused request should not leak plan state (ENG-11). Pure and cheap, so
   * `create` calls it too and remains safe called directly.
   */
  assertMayAssignOnCreate(requested: string | undefined, viewer: Viewer): void {
    if (!requested || requested === viewer.userId.toString()) return;
    if (!viewer.isOrganizer) {
      throw AppError.forbidden('Only organizers can assign a lead to someone else');
    }
  },

  async create(data: Record<string, unknown>, viewer: Viewer): Promise<LeadView> {
    const organizationId = requireOrganizationId();

    // A lead nobody owns is a lead nobody works. Default to the creator.
    let assignedTo = viewer.userId;
    const requested = data.assignedTo as string | undefined;
    leadService.assertMayAssignOnCreate(requested, viewer);
    if (requested && requested !== viewer.userId.toString()) {
      assignedTo = (await assertAssignable(requested))._id;
    }

    // The form lets a lead start at any stage — one that arrives already
    // qualified is not "new". A drop still needs its reason.
    const stage = (data.stage as LeadStage | undefined) ?? 'new';
    const lostReason = typeof data.lostReason === 'string' ? data.lostReason.trim() : '';
    if (stage === 'drop' && !lostReason) throw lostReasonRequired();

    if (data.allowDuplicate !== true) {
      await assertNotDuplicate(data.contactPhone as string, viewer);
    }

    // Validated before the number is taken, so a refused create does not burn
    // a lead number.
    const leadNumber = await nextDisplayNumber('lead');
    const lead = await Lead.create({
      ...sanitize(data),
      stage,
      ...(stage === 'drop'
        ? { lostReason, dropReason: await matchDropReason(lostReason) }
        : {}),
      leadNumber,
      createdBy: viewer.userId,
      assignedTo,
      assignedBy: viewer.userId,
      assignedAt: new Date(),
    });

    // Rolling counter so the console can render usage without counting every
    // tenant's leads on every page load.
    void Organization.updateOne(
      { _id: organizationId },
      { $inc: { 'usage.leads': 1 }, $set: { 'usage.lastActivityAt': new Date() } }
    ).catch(() => undefined);

    await notificationService.notify({
      type: 'lead_assigned',
      recipients: [assignedTo],
      actor: viewer,
      entityId: lead._id,
      subject: lead.contactName,
    });

    await leadThreadService.recordActivity(
      lead._id,
      'lead_created',
      stage === 'new'
        ? `Lead created by ${viewer.name}`
        : `Lead created by ${viewer.name} at ${stageLabel(stage)}`,
      viewer,
      { stage }
    );

    await lead.populate(POPULATE_LIST as unknown as string[]);
    return presentDoc(lead, viewer);
  },

  async list(filters: LeadFilters, viewer: Viewer) {
    const query: FilterQuery<ILead> = { isActive: true };
    const timeZone = zoneOf(viewer);

    if (filters.deleted) {
      // Restoring is an organizer's call, so only they browse what was deleted.
      if (!viewer.isOrganizer) throw AppError.forbidden('Only organizers can see deleted leads');
      query.isActive = false;
    }

    if (!viewer.isOrganizer) {
      // An agent's list is their own book. `$or` rather than `assignedTo` alone
      // so a lead they created but handed on stays visible to them.
      query.$and = [
        { $or: [{ assignedTo: viewer.userId }, { createdBy: viewer.userId }] },
      ];
    }

    if (filters.stage) query.stage = filters.stage;
    if (filters.priority) query.priority = filters.priority;
    if (filters.source) query.source = filters.source;
    if (filters.interestedIn) query.interestedIn = filters.interestedIn;
    if (filters.project) query.project = new Types.ObjectId(filters.project);
    if (filters.assignedTo && viewer.isOrganizer) {
      query.assignedTo = new Types.ObjectId(filters.assignedTo);
    }

    if (filters.overdueFollowUp) {
      query.nextFollowUpAt = { $lt: new Date() };
      query.stage = { $nin: TERMINAL_LEAD_STAGES };
    }

    // A person's own shortcut list — not everyone's.
    if (filters.bookmarked) query.bookmarkedBy = viewer.userId;

    if (filters.reminderScope) {
      query.stage = { $nin: TERMINAL_LEAD_STAGES };
      if (filters.reminderScope === 'overdue') {
        query.nextFollowUpAt = { $lt: new Date(), $ne: null };
      } else {
        // "Today" is the user's day, not the server's.
        const today = calendarDayOf(new Date(), timeZone);
        const { start, end } = dayBounds(
          filters.reminderScope === 'tomorrow' ? addDays(today, 1) : today,
          timeZone
        );
        query.nextFollowUpAt = { $gte: start, $lte: end };
      }
    }

    const created = safeDayRange(filters.dateFrom, filters.dateTo, timeZone);
    if (created) query.createdAt = created;

    // "Budget between X and Y" means the lead's range overlaps the filter's,
    // not that its endpoints sit inside it.
    if (filters.budgetMin !== undefined) query.budgetMax = { $gte: filters.budgetMin };
    if (filters.budgetMax !== undefined) query.budgetMin = { $lte: filters.budgetMax };

    if (filters.search) {
      const regex = new RegExp(escapeRegex(filters.search), 'i');
      const searchClause = {
        $or: [
          { contactName: regex },
          { contactPhone: regex },
          { leadNumber: regex },
          { interestedIn: regex },
        ],
      };
      // Merged under $and so it cannot clobber the visibility $or above — the
      // bug where a search makes an agent see the whole organization.
      query.$and = [...((query.$and as object[]) ?? []), searchClause];
    }

    const { page, limit, skip } = pageParams(filters);

    const [rows, total] = await Promise.all([
      Lead.find(query)
        .populate(POPULATE_LIST as unknown as string[])
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Lead.countDocuments(query),
    ]);

    const data = rows.map((row) => presentLead(row as unknown as Record<string, unknown>, viewer));
    return { data, total, page, limit };
  },

  async getById(leadId: string, viewer: Viewer): Promise<LeadView> {
    const lead = await Lead.findOne({ _id: leadId, isActive: true }).populate(
      POPULATE_DETAIL as unknown as string[]
    );
    if (!lead) throw AppError.notFound('Lead not found');
    if (!canSeeLead(lead, viewer)) throw AppError.forbidden('Access denied');
    return presentDoc(lead, viewer);
  },

  async update(
    leadId: string,
    data: Record<string, unknown>,
    viewer: Viewer
  ): Promise<LeadView> {
    const lead = await findVisibleLead(leadId, viewer);
    const safe = sanitize(data);

    // `assignedTo` is accepted here for the edit form, but it is still
    // assignment: without this check the generic update was a way round the
    // organizer-only /assign endpoint for any agent.
    let reassignedTo: { _id: Types.ObjectId; name: string } | undefined;
    if (safe.assignedTo !== undefined) {
      const requested = String(safe.assignedTo);
      if (requested !== lead.assignedTo?.toString()) {
        if (!viewer.isOrganizer) {
          throw AppError.forbidden('Only organizers can reassign leads');
        }
        reassignedTo = await assertAssignable(requested);
      }
      delete safe.assignedTo;
    }

    // Changing the number to one another lead already has is the same
    // duplicate as creating it.
    if (
      typeof safe.contactPhone === 'string' &&
      safe.contactPhone !== lead.contactPhone &&
      data.allowDuplicate !== true
    ) {
      await assertNotDuplicate(safe.contactPhone, viewer, lead._id);
    }

    // The reason can be corrected while the lead is dropped; it means nothing otherwise.
    if (typeof data.lostReason === 'string' && lead.stage === 'drop') {
      const reason = data.lostReason.trim();
      if (!reason) throw lostReasonRequired();
      lead.lostReason = reason;
      lead.dropReason = await matchDropReason(reason);
    }

    Object.assign(lead, safe);
    if (reassignedTo) {
      lead.assignedTo = reassignedTo._id;
      lead.assignedBy = viewer.userId;
      lead.assignedAt = new Date();
    }
    await lead.save();

    if (reassignedTo) await announceReassignment(lead, reassignedTo, viewer);

    await lead.populate(POPULATE_LIST as unknown as string[]);
    return presentDoc(lead, viewer);
  },

  /**
   * Changing the stage and setting the next follow-up happen in one dialog in
   * the app, so this takes both rather than making the client round-trip through
   * `update` for the reminder half.
   */
  async updateStage(
    leadId: string,
    newStage: LeadStage,
    viewer: Viewer,
    options: {
      lostReason?: string;
      nextFollowUpAt?: Date | null;
      reminderMinutesBefore?: number[];
    } = {}
  ): Promise<LeadView> {
    const lead = await findVisibleLead(leadId, viewer);

    const allowed = VALID_LEAD_STAGE_TRANSITIONS[lead.stage] ?? [];
    if (!allowed.includes(newStage)) {
      throw AppError.badRequest(
        `Cannot move lead from "${lead.stage}" to "${newStage}"`,
        { from: lead.stage, to: newStage, allowed }
      );
    }

    if (options.nextFollowUpAt !== undefined) {
      lead.nextFollowUpAt = options.nextFollowUpAt ?? undefined;
    }
    if (options.reminderMinutesBefore !== undefined) {
      lead.reminderMinutesBefore = options.reminderMinutesBefore;
    }

    // A dropped lead nobody can explain is a lead nobody learns from.
    const reason = options.lostReason?.trim();
    if (newStage === 'drop') {
      if (!reason) throw lostReasonRequired();
      lead.lostReason = reason;
      lead.dropReason = await matchDropReason(reason);
    } else if (lead.stage === 'drop') {
      // Reopened: the old reason no longer describes it.
      lead.lostReason = undefined;
      lead.dropReason = undefined;
    }

    const previous = lead.stage;
    lead.stage = newStage;
    await lead.save();

    await leadThreadService.recordActivity(
      lead._id,
      'stage_changed',
      `${viewer.name} moved the lead from ${stageLabel(previous)} to ${stageLabel(newStage)}` +
        (newStage === 'drop' && reason ? ` — ${reason}` : ''),
      viewer,
      { from: previous, to: newStage }
    );

    await lead.populate(POPULATE_LIST as unknown as string[]);
    return presentDoc(lead, viewer);
  },

  async assign(leadId: string, assignToUserId: string, viewer: Viewer): Promise<LeadView> {
    const lead = await Lead.findOne({ _id: leadId, isActive: true });
    if (!lead) throw AppError.notFound('Lead not found');

    const assignee = await assertAssignable(assignToUserId);
    const isChange = !lead.assignedTo?.equals(assignee._id);

    lead.assignedTo = assignee._id;
    lead.assignedBy = viewer.userId;
    lead.assignedAt = new Date();
    await lead.save();

    if (isChange) await announceReassignment(lead, assignee, viewer);

    await lead.populate(POPULATE_LIST as unknown as string[]);
    return presentDoc(lead, viewer);
  },

  /** The bookmark quick-action — the reader's own flag, toggled atomically. */
  async toggleBookmark(leadId: string, viewer: Viewer): Promise<LeadView> {
    const lead = await findVisibleLead(leadId, viewer);
    const marked = lead.bookmarkedBy.some((id) => id.equals(viewer.userId));
    await Lead.updateOne(
      { _id: lead._id },
      marked
        ? { $pull: { bookmarkedBy: viewer.userId } }
        : { $addToSet: { bookmarkedBy: viewer.userId } }
    );
    return leadService.getById(leadId, viewer);
  },

  /**
   * Soft delete. The lead's tasks and meetings are archived with it — left
   * active, they stayed in lists and on the calendar pointing at a lead nobody
   * could open. They are marked, so a restore brings back exactly these and not
   * something a person closed on purpose.
   */
  async remove(leadId: string): Promise<void> {
    const lead = await Lead.findOne({ _id: leadId, isActive: true });
    if (!lead) throw AppError.notFound('Lead not found');
    lead.isActive = false;
    await lead.save();

    await Promise.all([
      Task.updateMany(
        { leadId: lead._id, isActive: true },
        { $set: { isActive: false, archivedWithLead: true } }
      ),
      Meeting.updateMany(
        { leadId: lead._id, isActive: true },
        { $set: { isActive: false, archivedWithLead: true } }
      ),
    ]);

    void Organization.updateOne(
      { _id: requireOrganizationId() },
      { $inc: { 'usage.leads': -1 } }
    ).catch(() => undefined);
  },

  /** Undo a delete: the lead, and the work that was archived with it. */
  async restore(leadId: string, viewer: Viewer): Promise<LeadView> {
    const lead = await Lead.findOne({ _id: leadId, isActive: false });
    if (!lead) throw AppError.notFound('Deleted lead not found');
    lead.isActive = true;
    await lead.save();

    await Promise.all([
      Task.updateMany(
        { leadId: lead._id, archivedWithLead: true },
        { $set: { isActive: true }, $unset: { archivedWithLead: 1 } }
      ),
      Meeting.updateMany(
        { leadId: lead._id, archivedWithLead: true },
        { $set: { isActive: true }, $unset: { archivedWithLead: 1 } }
      ),
    ]);

    void Organization.updateOne(
      { _id: requireOrganizationId() },
      { $inc: { 'usage.leads': 1 } }
    ).catch(() => undefined);

    await leadThreadService.recordActivity(
      lead._id,
      'lead_restored',
      `${viewer.name} restored the lead`,
      viewer
    );

    return leadService.getById(leadId, viewer);
  },

  /**
   * Every customer number the caller can see, as digits.
   *
   * The phone downloads this to decide, on the device, which calls belong to a
   * customer — so a call to anyone else is discarded before it is sent
   * anywhere (ADR-0005). It carries numbers and ids only: no names, no notes.
   */
  async phoneIndex(viewer: Viewer): Promise<Array<{ leadId: string; phone: string }>> {
    const query: FilterQuery<ILead> = { isActive: true };
    if (!viewer.isOrganizer) {
      query.$or = [{ assignedTo: viewer.userId }, { createdBy: viewer.userId }];
    }

    const leads = await Lead.find(query)
      .select('contactPhone contactSecondPhone')
      .limit(20_000)
      .lean();

    const index: Array<{ leadId: string; phone: string }> = [];
    for (const lead of leads) {
      for (const phone of [lead.contactPhone, lead.contactSecondPhone]) {
        const digits = (phone ?? '').replace(/\D/g, '');
        // The last ten digits: the same number reaches the phone with and
        // without a country code, and matching has to survive both.
        if (digits.length >= 10) index.push({ leadId: lead._id.toString(), phone: digits.slice(-10) });
      }
    }
    return index;
  },

  async listCallLogs(leadId: string, viewer: Viewer, page = 1, limit = 20) {
    const lead = await findVisibleLead(leadId, viewer);

    const params = pageParams({ page, limit });
    const [data, total] = await Promise.all([
      CallLog.find({ leadId: lead._id })
        .populate('calledBy', 'name role avatarUrl')
        .sort({ calledAt: -1 })
        .skip(params.skip)
        .limit(params.limit)
        .lean(),
      CallLog.countDocuments({ leadId: lead._id }),
    ]);

    return { data, total, page: params.page, limit: params.limit };
  },

  /**
   * Counts for the dashboard, in three aggregations rather than one per stage.
   * The tenant `$match` is prepended by the tenant plugin.
   */
  async dashboardStats(
    viewer: Viewer,
    filters: { project?: string; assignedTo?: string } = {}
  ) {
    const base: FilterQuery<ILead> = { isActive: true };
    if (!viewer.isOrganizer) {
      base.$or = [{ assignedTo: viewer.userId }, { createdBy: viewer.userId }];
    } else if (filters.assignedTo) {
      // One member's book, for the organizer's per-member view — the same
      // meaning `assignedTo` has on the list, so tab counts match the rows.
      // An agent is already confined to their own, so it is ignored for them.
      base.assignedTo = new Types.ObjectId(filters.assignedTo);
    }
    if (filters.project) base.project = new Types.ObjectId(filters.project);

    const [byStage, byPriority, overdueFollowUps] = await Promise.all([
      Lead.aggregate([
        { $match: base },
        { $group: { _id: '$stage', count: { $sum: 1 } } },
      ]),
      Lead.aggregate([
        { $match: { ...base, stage: { $nin: TERMINAL_LEAD_STAGES } } },
        { $group: { _id: '$priority', count: { $sum: 1 } } },
      ]),
      Lead.countDocuments({
        ...base,
        nextFollowUpAt: { $lt: new Date() },
        stage: { $nin: TERMINAL_LEAD_STAGES },
      }),
    ]);

    const stageMap = toCountMap(byStage);
    const priorityMap = toCountMap(byPriority);

    return {
      // Built from LEAD_STAGE_ORDER so adding a stage counts it without touching
      // this function — a hardcoded shape silently reports 0 for new stages.
      byStage: LEAD_STAGE_ORDER.reduce<Record<string, number>>((acc, stage) => {
        acc[stage] = stageMap[stage] ?? 0;
        return acc;
      }, {}),
      byPriority: {
        hot: priorityMap.hot ?? 0,
        warm: priorityMap.warm ?? 0,
        cold: priorityMap.cold ?? 0,
      } satisfies Record<LeadPriority, number>,
      overdueFollowUps,
      total: Object.values(stageMap).reduce((a, b) => a + b, 0),
    };
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function lostReasonRequired(): AppError {
  return new AppError(
    'Say why the lead is being dropped — pick a drop reason or write one.',
    400,
    'LOST_REASON_REQUIRED'
  );
}

/** Date filters are the user's days; an unreadable one is a 400, not a 500. */
function safeDayRange(from: string | undefined, to: string | undefined, timeZone: string) {
  try {
    return dayRange(from, to, timeZone);
  } catch (error) {
    throw AppError.badRequest(error instanceof Error ? error.message : 'Invalid date filter');
  }
}

/**
 * The organization's drop tag a reason names. The app writes "Tag — note" when
 * both are given, so a reason matches a tag when it is the tag, or starts with it.
 */
async function matchDropReason(reason: string): Promise<Types.ObjectId | undefined> {
  const tags = await LeadDropReason.find({}).select('name').lean<{ _id: Types.ObjectId; name: string }[]>();
  const tag = tags.find((t) => reason === t.name || reason.startsWith(`${t.name} — `));
  return tag?._id;
}

/**
 * One phone number, one live lead — unless the person, having been told, says
 * otherwise. The answer names the existing lead only as far as the asker may
 * see it: its number always, its contact and id only when it is theirs.
 */
async function assertNotDuplicate(
  phone: string,
  viewer: Viewer,
  excludeLeadId?: Types.ObjectId
): Promise<void> {
  if (!phone) return;
  const existing = await Lead.findOne({
    isActive: true,
    $or: [{ contactPhone: phone }, { contactSecondPhone: phone }],
    ...(excludeLeadId ? { _id: { $ne: excludeLeadId } } : {}),
  })
    .select('leadNumber contactName assignedTo createdBy')
    .lean<{
      _id: Types.ObjectId;
      leadNumber: string;
      contactName: string;
      assignedTo?: Types.ObjectId;
      createdBy: Types.ObjectId;
    }>();
  if (!existing) return;

  const visible = canSeeLead(existing, viewer);
  const owner = existing.assignedTo
    ? await User.findById(existing.assignedTo).select('name').lean<{ name: string }>()
    : null;

  throw new AppError(
    `A lead with this phone number already exists (${existing.leadNumber}).`,
    409,
    'DUPLICATE_LEAD',
    {
      leadNumber: existing.leadNumber,
      assignedToName: owner?.name,
      ...(visible ? { leadId: existing._id.toString(), contactName: existing.contactName } : {}),
    }
  );
}

async function announceReassignment(
  lead: ILead,
  assignee: { _id: Types.ObjectId; name: string },
  viewer: Viewer
): Promise<void> {
  await notificationService.notify({
    type: 'lead_assigned',
    recipients: [assignee._id],
    actor: viewer,
    entityId: lead._id,
    subject: lead.contactName,
  });
  await leadThreadService.recordActivity(
    lead._id,
    'lead_reassigned',
    `${viewer.name} assigned the lead to ${assignee.name}`,
    viewer,
    { assignedTo: assignee._id.toString() }
  );
}

/**
 * Recomputes the lead's denormalised call count and last call from the call
 * logs themselves, so every write to a lead's calls leaves it true. Exported
 * for the device-call sync, which is the only thing that writes them now.
 */
export async function refreshCallSummary(leadId: Types.ObjectId): Promise<void> {
  const [count, latest] = await Promise.all([
    CallLog.countDocuments({ leadId }),
    CallLog.findOne({ leadId }).sort({ calledAt: -1 }).lean(),
  ]);

  await Lead.updateOne(
    { _id: leadId },
    latest
      ? {
          $set: {
            callCount: count,
            lastContactedAt: latest.calledAt,
            latestCallLog: {
              _id: latest._id.toString(),
              outcome: latest.outcome,
              calledAt: latest.calledAt,
              calledByName: latest.calledByName,
              notes: latest.notes,
            },
          },
        }
      : { $set: { callCount: 0 }, $unset: { latestCallLog: 1 } }
  );
}

/**
 * A lead may only go to an active member of this organization. The lookup is
 * tenant-scoped by the plugin, so another tenant's user id is simply not found;
 * a deactivated user would otherwise collect leads nobody can see.
 */
async function assertAssignable(userId: string): Promise<{ _id: Types.ObjectId; name: string }> {
  const user = Types.ObjectId.isValid(userId)
    ? await User.findOne({ _id: userId, isActive: true })
        .select('_id name')
        .lean<{ _id: Types.ObjectId; name: string }>()
    : null;
  if (!user) {
    throw AppError.badRequest('The assignee must be an active member of this organization');
  }
  return user;
}

/**
 * Strip fields a client must never set directly. Server-owned bookkeeping
 * (`leadNumber`, `callCount`, `latestCallLog`, bookmarks) and anything handled
 * explicitly (`stage`, `lostReason`).
 */
function sanitize(data: Record<string, unknown>): Record<string, unknown> {
  const {
    leadNumber: _leadNumber,
    stage: _stage,
    lostReason: _lostReason,
    dropReason: _dropReason,
    createdBy: _createdBy,
    callCount: _callCount,
    latestCallLog: _latestCallLog,
    organizationId: _organizationId,
    isActive: _isActive,
    assignedBy: _assignedBy,
    assignedAt: _assignedAt,
    bookmarkedBy: _bookmarkedBy,
    isBookmarked: _isBookmarked,
    allowDuplicate: _allowDuplicate,
    ...safe
  } = data;

  if (safe.contactEmail === '') delete safe.contactEmail;
  if (safe.contactSecondPhone === '') safe.contactSecondPhone = undefined;
  if (typeof safe.nextFollowUpAt === 'string') {
    safe.nextFollowUpAt = new Date(safe.nextFollowUpAt);
  }
  if (typeof safe.project === 'string') {
    safe.project = new Types.ObjectId(safe.project);
  }
  if (typeof safe.assignedTo === 'string') {
    safe.assignedTo = new Types.ObjectId(safe.assignedTo);
  }
  return safe;
}

/** User input goes into a RegExp; `.` and `*` would otherwise be operators. */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toCountMap(rows: Array<{ _id: string; count: number }>): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, { _id, count }) => {
    if (_id) acc[_id] = count;
    return acc;
  }, {});
}
