import { Types, type FilterQuery } from 'mongoose';
import { Lead, type ILead } from '../../models/Lead.js';
import { CallLog, type ICallLog } from '../../models/CallLog.js';
import { Organization } from '../../models/Organization.js';
import { User } from '../../models/User.js';
import { AppError } from '../../lib/errors.js';
import { nextDisplayNumber } from '../../lib/counters.js';
import { pageParams } from '../../lib/pagination.js';
import { requireOrganizationId } from '../../lib/tenantContext.js';
import { notificationService } from '../notifications/notification.service.js';
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
}

/** Start and end of a day in server-local time. */
function dayBounds(base: Date): { start: Date; end: Date } {
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(base);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

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

  async create(data: Record<string, unknown>, viewer: Viewer): Promise<ILead> {
    const organizationId = requireOrganizationId();

    // A lead nobody owns is a lead nobody works. Default to the creator.
    let assignedTo = viewer.userId;
    const requested = data.assignedTo as string | undefined;
    leadService.assertMayAssignOnCreate(requested, viewer);
    if (requested && requested !== viewer.userId.toString()) {
      assignedTo = await assertAssignable(requested);
    }

    // Validated before the number is taken, so a refused create does not burn
    // a lead number.
    const leadNumber = await nextDisplayNumber('lead');
    const lead = await Lead.create({
      ...sanitize(data),
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

    return lead.populate(POPULATE_LIST as unknown as string[]);
  },

  async list(filters: LeadFilters, viewer: Viewer) {
    const query: FilterQuery<ILead> = { isActive: true };

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

    if (filters.bookmarked) query.isBookmarked = true;

    if (filters.reminderScope) {
      query.stage = { $nin: TERMINAL_LEAD_STAGES };
      if (filters.reminderScope === 'overdue') {
        query.nextFollowUpAt = { $lt: new Date(), $ne: null };
      } else {
        const base = new Date();
        if (filters.reminderScope === 'tomorrow') base.setDate(base.getDate() + 1);
        const { start, end } = dayBounds(base);
        query.nextFollowUpAt = { $gte: start, $lte: end };
      }
    }

    if (filters.dateFrom || filters.dateTo) {
      const range: Record<string, Date> = {};
      if (filters.dateFrom) range.$gte = new Date(filters.dateFrom);
      if (filters.dateTo) {
        const end = new Date(filters.dateTo);
        end.setHours(23, 59, 59, 999);
        range.$lte = end;
      }
      query.createdAt = range;
    }

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

    const [data, total] = await Promise.all([
      Lead.find(query)
        .populate(POPULATE_LIST as unknown as string[])
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Lead.countDocuments(query),
    ]);

    return { data, total, page, limit };
  },

  async getById(leadId: string, viewer: Viewer): Promise<ILead> {
    const lead = await Lead.findOne({ _id: leadId, isActive: true }).populate(
      POPULATE_DETAIL as unknown as string[]
    );
    if (!lead) throw AppError.notFound('Lead not found');
    assertCanSee(lead, viewer);
    return lead;
  },

  async update(
    leadId: string,
    data: Record<string, unknown>,
    viewer: Viewer
  ): Promise<ILead> {
    const lead = await Lead.findOne({ _id: leadId, isActive: true });
    if (!lead) throw AppError.notFound('Lead not found');
    assertCanSee(lead, viewer);

    const safe = sanitize(data);

    // `assignedTo` is accepted here for the organizer's edit form, but it is
    // still assignment: without this check the generic update was a way round
    // the organizer-only /assign endpoint for any agent.
    let reassignedTo: Types.ObjectId | undefined;
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

    Object.assign(lead, safe);
    if (reassignedTo) {
      lead.assignedTo = reassignedTo;
      lead.assignedBy = viewer.userId;
      lead.assignedAt = new Date();
    }
    await lead.save();

    if (reassignedTo) {
      await notificationService.notify({
        type: 'lead_assigned',
        recipients: [reassignedTo],
        actor: viewer,
        entityId: lead._id,
        subject: lead.contactName,
      });
    }

    return lead.populate(POPULATE_LIST as unknown as string[]);
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
  ): Promise<ILead> {
    const lead = await Lead.findOne({ _id: leadId, isActive: true });
    if (!lead) throw AppError.notFound('Lead not found');
    assertCanSee(lead, viewer);

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

    lead.stage = newStage;
    if (newStage === 'drop' && options.lostReason) lead.lostReason = options.lostReason;
    await lead.save();
    return lead.populate(POPULATE_LIST as unknown as string[]);
  },

  async assign(
    leadId: string,
    assignToUserId: string,
    viewer: Viewer
  ): Promise<ILead> {
    const lead = await Lead.findOne({ _id: leadId, isActive: true });
    if (!lead) throw AppError.notFound('Lead not found');

    const assignee = await assertAssignable(assignToUserId);
    const isChange = !lead.assignedTo?.equals(assignee);

    lead.assignedTo = assignee;
    lead.assignedBy = viewer.userId;
    lead.assignedAt = new Date();
    await lead.save();

    if (isChange) {
      await notificationService.notify({
        type: 'lead_assigned',
        recipients: [assignee],
        actor: viewer,
        entityId: lead._id,
        subject: lead.contactName,
      });
    }

    return lead.populate(POPULATE_LIST as unknown as string[]);
  },

  /** The bookmark quick-action — a single-field toggle, not a general update. */
  async toggleBookmark(leadId: string, viewer: Viewer): Promise<ILead> {
    const lead = await Lead.findOne({ _id: leadId, isActive: true });
    if (!lead) throw AppError.notFound('Lead not found');
    assertCanSee(lead, viewer);

    lead.isBookmarked = !lead.isBookmarked;
    await lead.save();
    return lead;
  },

  /** Soft delete — the lead's call history and threads stay referentially intact. */
  async remove(leadId: string): Promise<void> {
    const lead = await Lead.findById(leadId);
    if (!lead) throw AppError.notFound('Lead not found');
    lead.isActive = false;
    await lead.save();

    void Organization.updateOne(
      { _id: requireOrganizationId() },
      { $inc: { 'usage.leads': -1 } }
    ).catch(() => undefined);
  },

  async addCallLog(
    leadId: string,
    data: {
      outcome: string;
      duration?: number;
      calledAt?: Date;
      notes?: string;
      nextFollowUpAt?: Date;
    },
    viewer: Viewer
  ): Promise<ICallLog> {
    const lead = await Lead.findOne({ _id: leadId, isActive: true });
    if (!lead) throw AppError.notFound('Lead not found');
    assertCanSee(lead, viewer);

    const callLog = await CallLog.create({
      leadId: new Types.ObjectId(leadId),
      calledBy: viewer.userId,
      calledByName: viewer.name,
      calledByRole: viewer.role,
      calledAt: data.calledAt ?? new Date(),
      duration: data.duration,
      outcome: data.outcome,
      notes: data.notes,
      nextFollowUpAt: data.nextFollowUpAt,
    });

    // Denormalised onto the lead so the list can show last-contact without a
    // second query per row.
    lead.callCount = (lead.callCount ?? 0) + 1;
    lead.lastContactedAt = callLog.calledAt;
    lead.latestCallLog = {
      _id: callLog._id.toString(),
      outcome: callLog.outcome,
      calledAt: callLog.calledAt,
      calledByName: callLog.calledByName,
      notes: callLog.notes,
    };
    if (data.nextFollowUpAt) lead.nextFollowUpAt = data.nextFollowUpAt;
    await lead.save();

    return callLog;
  },

  async listCallLogs(leadId: string, viewer: Viewer, page = 1, limit = 20) {
    const lead = await Lead.findOne({ _id: leadId, isActive: true }).select(
      'assignedTo createdBy'
    );
    if (!lead) throw AppError.notFound('Lead not found');
    assertCanSee(lead, viewer);

    const params = pageParams({ page, limit });
    const [data, total] = await Promise.all([
      CallLog.find({ leadId: new Types.ObjectId(leadId) })
        .populate('calledBy', 'name role avatarUrl')
        .sort({ calledAt: -1 })
        .skip(params.skip)
        .limit(params.limit)
        .lean(),
      CallLog.countDocuments({ leadId: new Types.ObjectId(leadId) }),
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

/**
 * An agent may only touch a lead assigned to or created by them. Organizers see
 * everything in their organization.
 *
 * This is *within*-tenant authorization. Cross-tenant isolation is already
 * guaranteed by the tenant plugin before this ever runs — a lead from another
 * organization is not found at all, so this never sees one.
 */
function assertCanSee(
  lead: Pick<ILead, 'assignedTo' | 'createdBy'>,
  viewer: Viewer
): void {
  if (viewer.isOrganizer) return;
  const uid = viewer.userId.toString();
  const isOwner =
    lead.assignedTo?.toString() === uid || lead.createdBy?.toString() === uid;
  if (!isOwner) throw AppError.forbidden('Access denied');
}

/**
 * A lead may only go to an active member of this organization. The lookup is
 * tenant-scoped by the plugin, so another tenant's user id is simply not found;
 * a deactivated user would otherwise collect leads nobody can see.
 */
async function assertAssignable(userId: string): Promise<Types.ObjectId> {
  const user = await User.findOne({ _id: userId, isActive: true }).select('_id').lean();
  if (!user) {
    throw AppError.badRequest('The assignee must be an active member of this organization');
  }
  return user._id;
}

/**
 * Strip fields a client must never set directly. Server-owned bookkeeping
 * (`leadNumber`, `callCount`, `latestCallLog`) and anything with its own guarded
 * endpoint (`stage`).
 */
function sanitize(data: Record<string, unknown>): Record<string, unknown> {
  const {
    leadNumber: _leadNumber,
    stage: _stage,
    createdBy: _createdBy,
    callCount: _callCount,
    latestCallLog: _latestCallLog,
    organizationId: _organizationId,
    isActive: _isActive,
    assignedBy: _assignedBy,
    assignedAt: _assignedAt,
    ...safe
  } = data;

  if (safe.contactEmail === '') delete safe.contactEmail;
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
