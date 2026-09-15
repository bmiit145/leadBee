import api from './api';
import { Meeting, MeetingType, MeetingStatus, MeetingSlotsResponse, PaginatedResponse, ApiResponse } from '../types';

/** The meeting list's tabs, as the API names them. */
export type MeetingTab =
  | 'all'
  | 'today'
  | 'tomorrow'
  | 'upcoming'
  | 'completed'
  | 'cancelled'
  | 'rescheduled'
  | 'missed';

export interface MeetingFilters {
  status?: MeetingStatus;
  leadId?: string;
  assignedTo?: string;
  /** A tab other than `all`. */
  scope?: Exclude<MeetingTab, 'all'> | 'past';
  dateFrom?: string;
  dateTo?: string;
  /** Customer name, mobile or lead number, or the meeting number — searched on the server. */
  search?: string;
  meetingType?: MeetingType;
  /** A purpose of inquiry's id. */
  purpose?: string;
  page?: number;
  limit?: number;
}

function meetingParams(filters: MeetingFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status) params.append('status', filters.status);
  if (filters.leadId) params.append('leadId', filters.leadId);
  if (filters.assignedTo) params.append('assignedTo', filters.assignedTo);
  if (filters.scope) params.append('scope', filters.scope);
  if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.append('dateTo', filters.dateTo);
  if (filters.search) params.append('search', filters.search);
  if (filters.meetingType) params.append('meetingType', filters.meetingType);
  if (filters.purpose) params.append('purpose', filters.purpose);
  if (filters.page) params.append('page', String(filters.page));
  if (filters.limit) params.append('limit', String(filters.limit));
  return params;
}

export interface MeetingFormData {
  leadId: string;
  scheduledAt: string;
  durationMinutes?: number;
  meetingType: MeetingType;
  assignedTo?: string[];
  purpose?: string;
  reminderMinutesBefore?: number[];
  notes?: string;
  /** "Meeting Purpose" entries typed before the meeting exists — sent once, with creation. */
  comments?: { text: string }[];
}

export const meetingService = {
  async getAll(filters: MeetingFilters = {}): Promise<PaginatedResponse<Meeting>> {
    const res = await api.get<PaginatedResponse<Meeting>>(`/meetings?${meetingParams(filters).toString()}`);
    return res.data;
  },

  /** Each tab's count under the same filters as the list. */
  async getTabCounts(
    filters: Omit<MeetingFilters, 'scope' | 'status' | 'page' | 'limit'> = {}
  ): Promise<Record<MeetingTab, number>> {
    const res = await api.get<ApiResponse<Record<MeetingTab, number>>>(
      `/meetings/stats/tab-counts?${meetingParams(filters).toString()}`
    );
    return res.data.data;
  },

  /**
   * Powers the "Select meeting time" sheet — free/busy/past per slot for the day.
   *
   * `date` is `YYYY-MM-DD` as the user sees it; the API reads it in the phone's
   * time zone. Availability is for `attendees` — with none chosen, the caller.
   */
  async getSlots(
    date: string,
    durationMinutes: number,
    attendees: string[] = [],
    excludeMeetingId?: string
  ): Promise<MeetingSlotsResponse> {
    const params = new URLSearchParams({ date, durationMinutes: String(durationMinutes) });
    if (attendees.length > 0) params.append('userIds', attendees.join(','));
    if (excludeMeetingId) params.append('excludeMeetingId', excludeMeetingId);

    const res = await api.get<ApiResponse<MeetingSlotsResponse>>(`/meetings/slots?${params.toString()}`);
    return res.data.data;
  },

  async getById(meetingId: string): Promise<Meeting> {
    const res = await api.get<ApiResponse<Meeting>>(`/meetings/${meetingId}`);
    return res.data.data;
  },

  /**
   * Also raises the meeting's companion task server-side. Rejects with 409
   * `MEETING_CONFLICT` when an attendee is already booked then.
   */
  async create(data: MeetingFormData): Promise<Meeting> {
    const res = await api.post<ApiResponse<Meeting>>('/meetings', data);
    return res.data.data;
  },

  /** Edit or reschedule. Moving the time marks it rescheduled and tells the attendees. */
  async update(
    meetingId: string,
    data: Partial<Omit<MeetingFormData, 'leadId' | 'comments'>>
  ): Promise<Meeting> {
    const res = await api.put<ApiResponse<Meeting>>(`/meetings/${meetingId}`, data);
    return res.data.data;
  },

  /** Complete, cancel, or reopen (`scheduled`). The linked task follows. */
  async setStatus(meetingId: string, status: MeetingStatus, outcome?: string): Promise<Meeting> {
    const res = await api.patch<ApiResponse<Meeting>>(`/meetings/${meetingId}/status`, { status, outcome });
    return res.data.data;
  },

  /** Its booker or an organizer. */
  async remove(meetingId: string): Promise<void> {
    await api.delete(`/meetings/${meetingId}`);
  },

  /** Posts one entry to the "Meeting Purpose" comment thread. */
  async addComment(meetingId: string, text: string): Promise<Meeting> {
    const res = await api.post<ApiResponse<Meeting>>(`/meetings/${meetingId}/comments`, { text });
    return res.data.data;
  },
};
