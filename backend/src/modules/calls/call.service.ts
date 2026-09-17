import { Types, type FilterQuery } from 'mongoose';
import {
  CallLog,
  type CallDirection,
  type ICallLog,
} from '../../models/CallLog.js';
import { Lead } from '../../models/Lead.js';
import { AppError } from '../../lib/errors.js';
import { pageParams } from '../../lib/pagination.js';
import { dayRange } from '../../lib/zonedTime.js';
import { zoneOf } from '../../lib/viewer.js';
import type { CallOutcome } from '../../config/constants.js';
import {
  findVisibleLead,
  refreshCallSummary,
  type Viewer,
} from '../leads/lead.service.js';
import { leadThreadService } from '../leads/leadThread.service.js';

export interface CallFilters {
  direction?: CallDirection;
  leadId?: string;
  calledBy?: string;
  dateFrom?: string;
  dateTo?: string;
  /** Customer name, mobile or lead number. */
  search?: string;
  page?: number;
  limit?: number;
}

export interface DeviceCallInput {
  /** The phone's own id for this call log entry. */
  deviceCallId: string;
  leadId: string;
  phoneNumber: string;
  direction: CallDirection;
  calledAt: Date;
  durationSeconds?: number;
}

export interface RecordCallInput {
  leadId: string;
  /** Defaults to now: a call is recorded as it is placed. */
  calledAt?: Date;
  phoneNumber?: string;
  durationSeconds?: number;
  outcome?: CallOutcome;
}

const POPULATE = [
  { path: 'leadId', select: 'leadNumber contactName contactPhone stage' },
  { path: 'calledBy', select: 'name role avatarUrl' },
] as const;

/** User input goes into a RegExp; `.` and `*` would otherwise be operators. */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Who may see which calls. An organizer sees the organization's calls; everyone
 * else sees the calls they made — the same rule tasks and meetings follow.
 */
async function baseQuery(filters: CallFilters, viewer: Viewer): Promise<FilterQuery<ICallLog>> {
  const query: FilterQuery<ICallLog> = {};

  if (filters.leadId) {
    // Everyone who can see a lead sees its calls.
    await findVisibleLead(filters.leadId, viewer);
    query.leadId = new Types.ObjectId(filters.leadId);
  }

  if (!viewer.isOrganizer) {
    query.calledBy = viewer.userId;
  } else if (filters.calledBy) {
    query.calledBy = new Types.ObjectId(filters.calledBy);
  }

  if (filters.direction) query.direction = filters.direction;

  let range: ReturnType<typeof dayRange>;
  try {
    range = dayRange(filters.dateFrom, filters.dateTo, zoneOf(viewer));
  } catch (error) {
    throw AppError.badRequest(error instanceof Error ? error.message : 'Invalid date filter');
  }
  if (range) query.calledAt = range;

  const term = filters.search?.trim();
  if (term) {
    // The customer is on the lead, so matching leads come first. Visibility is
    // still the rule above — a matching lead grants no access on its own.
    const regex = new RegExp(escapeRegex(term), 'i');
    const leadIds = await Lead.distinct('_id', {
      $or: [{ contactName: regex }, { contactPhone: regex }, { leadNumber: regex }],
    });
    query.$and = [...((query.$and as object[]) ?? []), { $or: [{ leadId: { $in: leadIds } }, { phoneNumber: regex }] }];
  }

  return query;
}

export const callService = {
  /**
   * A call placed from inside LeadBee. This is the one kind a Play build can
   * measure: the app knows the lead because it dialled the number.
   * `durationSeconds` arrives later, from the call-state watcher, so a call is
   * recorded when it starts rather than being lost if the app is killed.
   */
  async record(input: RecordCallInput, viewer: Viewer): Promise<ICallLog> {
    const lead = await findVisibleLead(input.leadId, viewer);

    const call = await CallLog.create({
      leadId: lead._id,
      calledBy: viewer.userId,
      calledByName: viewer.name,
      calledByRole: viewer.role,
      source: 'app',
      direction: 'outgoing',
      phoneNumber: input.phoneNumber ?? lead.contactPhone,
      calledAt: input.calledAt ?? new Date(),
      duration: input.durationSeconds,
      outcome: input.outcome,
    });

    await refreshCallSummary(lead._id);
    await leadThreadService.recordActivity(
      lead._id,
      'call_logged',
      `${viewer.name} called ${lead.contactName}`,
      viewer,
      { callLogId: call._id.toString(), direction: 'outgoing' }
    );

    return call.populate(POPULATE as unknown as string[]);
  },

  /**
   * Completes a call once it ends: how long it lasted, and what the person
   * made of it. Only the member who placed it may complete it.
   */
  async complete(
    callId: string,
    data: { durationSeconds?: number; outcome?: CallOutcome },
    viewer: Viewer
  ): Promise<ICallLog> {
    if (!Types.ObjectId.isValid(callId)) throw AppError.notFound('Call not found');
    const call = await CallLog.findById(callId);
    if (!call) throw AppError.notFound('Call not found');
    if (!call.calledBy.equals(viewer.userId)) {
      throw AppError.forbidden('Only the person who made this call can complete it');
    }

    if (data.durationSeconds !== undefined) call.duration = data.durationSeconds;
    if (data.outcome !== undefined) call.outcome = data.outcome;
    await call.save();

    await refreshCallSummary(call.leadId);
    return call.populate(POPULATE as unknown as string[]);
  },

  /**
   * Calls the phone matched to a customer, in batches.
   *
   * The device has already thrown away everything that is not a customer's
   * number (ADR-0005), so what arrives here is work. Each entry carries the
   * phone's own id for the call, and `deviceCallId` is unique per member, so
   * re-sending a window — a retry, a reinstall, an overlapping range — writes
   * each call once.
   */
  async syncDevice(entries: DeviceCallInput[], viewer: Viewer) {
    if (entries.length === 0) return { written: 0, skipped: 0 };

    // One visibility check for the whole batch rather than per call.
    const leadIds = [...new Set(entries.map((entry) => entry.leadId))].filter((id) =>
      Types.ObjectId.isValid(id)
    );
    const visible = await Lead.find(
      viewer.isOrganizer
        ? { _id: { $in: leadIds } }
        : { _id: { $in: leadIds }, $or: [{ assignedTo: viewer.userId }, { createdBy: viewer.userId }] }
    )
      .select('_id')
      .lean();
    const allowed = new Set(visible.map((lead) => lead._id.toString()));

    const writable = entries.filter((entry) => allowed.has(entry.leadId));
    if (writable.length === 0) return { written: 0, skipped: entries.length };

    const result = await CallLog.bulkWrite(
      writable.map((entry) => ({
        updateOne: {
          filter: { calledBy: viewer.userId, deviceCallId: entry.deviceCallId },
          update: {
            $setOnInsert: {
              leadId: new Types.ObjectId(entry.leadId),
              calledBy: viewer.userId,
              calledByName: viewer.name,
              calledByRole: viewer.role,
              source: 'device',
              direction: entry.direction,
              deviceCallId: entry.deviceCallId,
              phoneNumber: entry.phoneNumber,
              calledAt: entry.calledAt,
              duration: entry.durationSeconds,
            },
          },
          upsert: true,
        },
      }))
    );

    // Denormalised call counts on each lead that gained a call.
    await Promise.all(
      [...new Set(writable.map((entry) => entry.leadId))].map((id) =>
        refreshCallSummary(new Types.ObjectId(id))
      )
    );

    return {
      written: result.upsertedCount,
      skipped: entries.length - result.upsertedCount,
    };
  },

  async list(filters: CallFilters, viewer: Viewer) {
    const query = await baseQuery(filters, viewer);
    const { page, limit, skip } = pageParams(filters);

    const [data, total] = await Promise.all([
      CallLog.find(query)
        .populate(POPULATE as unknown as string[])
        .sort({ calledAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CallLog.countDocuments(query),
    ]);

    return { data, total, page, limit };
  },

  /**
   * The counters behind Call Tracking and Call Analytics: how many calls and
   * how many seconds, per direction, under the list's own filters.
   *
   * Only directions this build can measure are counted. A Play build measures
   * outgoing calls it placed; incoming, missed and rejected need the phone's
   * call log, so they are absent here rather than reported as zero — the
   * screens show them as untracked (docs/CALL-TRACKING-PLATFORMS.md).
   */
  async stats(filters: Omit<CallFilters, 'direction' | 'page' | 'limit'>, viewer: Viewer) {
    const match = await baseQuery(filters, viewer);

    const rows = await CallLog.aggregate<{ _id: CallDirection; calls: number; seconds: number }>([
      { $match: match },
      {
        $group: {
          _id: '$direction',
          calls: { $sum: 1 },
          seconds: { $sum: { $ifNull: ['$duration', 0] } },
        },
      },
    ]);

    const byDirection = Object.fromEntries(
      rows.map((row) => [row._id, { calls: row.calls, seconds: row.seconds }])
    ) as Record<CallDirection, { calls: number; seconds: number }>;

    return {
      total: {
        calls: rows.reduce((sum, row) => sum + row.calls, 0),
        seconds: rows.reduce((sum, row) => sum + row.seconds, 0),
      },
      byDirection,
    };
  },

  /**
   * Who is calling, and who is being called: the two questions "call activity"
   * actually answers. Organizers get their team; everyone else gets themselves
   * and their own customers, which is what `baseQuery` already limits them to.
   */
  async activity(filters: Omit<CallFilters, 'page' | 'limit'>, viewer: Viewer) {
    const match = await baseQuery(filters, viewer);

    const [byMember, byLead] = await Promise.all([
      CallLog.aggregate<{ userId: string; name: string; calls: number; seconds: number }>([
        { $match: match },
        {
          $group: {
            _id: '$calledBy',
            name: { $last: '$calledByName' },
            calls: { $sum: 1 },
            seconds: { $sum: { $ifNull: ['$duration', 0] } },
          },
        },
        { $sort: { calls: -1 } },
        { $limit: 50 },
        { $project: { _id: 0, userId: { $toString: '$_id' }, name: 1, calls: 1, seconds: 1 } },
      ]),
      CallLog.aggregate<{ leadId: string; name: string; phone: string; calls: number; seconds: number }>([
        { $match: match },
        {
          $group: {
            _id: '$leadId',
            calls: { $sum: 1 },
            seconds: { $sum: { $ifNull: ['$duration', 0] } },
          },
        },
        { $sort: { calls: -1 } },
        { $limit: 20 },
        { $lookup: { from: 'leads', localField: '_id', foreignField: '_id', as: 'lead' } },
        { $unwind: { path: '$lead', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            leadId: { $toString: '$_id' },
            name: { $ifNull: ['$lead.contactName', 'Unknown'] },
            phone: { $ifNull: ['$lead.contactPhone', ''] },
            calls: 1,
            seconds: 1,
          },
        },
      ]),
    ]);

    return { byMember, byLead };
  },

  /**
   * Call Activity: the same calls grouped by day, for the trend on the
   * analytics screen. Days with no calls are absent — the screen fills gaps,
   * because it knows the range it asked for.
   */
  async daily(filters: Omit<CallFilters, 'page' | 'limit'>, viewer: Viewer) {
    const match = await baseQuery(filters, viewer);
    const timeZone = zoneOf(viewer);

    return CallLog.aggregate<{ day: string; calls: number; seconds: number }>([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { date: '$calledAt', format: '%Y-%m-%d', timezone: timeZone } },
          calls: { $sum: 1 },
          seconds: { $sum: { $ifNull: ['$duration', 0] } },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, day: '$_id', calls: 1, seconds: 1 } },
    ]);
  },
};
