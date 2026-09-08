import api from './api';
import { Meeting, MeetingType, MeetingStatus, MeetingSlotsResponse, MeetingComment, PaginatedResponse, ApiResponse } from '../types';

interface MeetingFilters {
  status?: MeetingStatus;
  leadId?: string;
  assignedTo?: string;
  scope?: 'today' | 'tomorrow' | 'upcoming' | 'past';
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

interface CreateMeetingData {
  leadId: string;
  scheduledAt: string;
  durationMinutes?: number;
  meetingType: MeetingType;
  assignedTo?: string[];
  purpose?: string;
  reminderMinutesBefore?: number[];
  notes?: string;
  /** Comments staged client-side before the meeting exists (Create Meeting's
   *  "Meeting Purpose" composer) — sent once, along with creation. */
  comments?: MeetingComment[];
}

export const meetingService = {
  async getAll(filters: MeetingFilters = {}): Promise<PaginatedResponse<Meeting>> {
    const params = new URLSearchParams();
    if (filters.status) params.append('status', filters.status);
    if (filters.leadId) params.append('leadId', filters.leadId);
    if (filters.assignedTo) params.append('assignedTo', filters.assignedTo);
    if (filters.scope) params.append('scope', filters.scope);
    if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.append('dateTo', filters.dateTo);
    if (filters.page) params.append('page', String(filters.page));
    if (filters.limit) params.append('limit', String(filters.limit));

    const res = await api.get<PaginatedResponse<Meeting>>(`/meetings?${params.toString()}`);
    return res.data;
  },

  /** Powers the "Select meeting time" sheet — free/busy/past per slot for the day. */
  async getSlots(
    date: string,
    durationMinutes: number,
    assignedTo: string[] = [],
    excludeMeetingId?: string
  ): Promise<MeetingSlotsResponse> {
    const params = new URLSearchParams({ date, durationMinutes: String(durationMinutes) });
    if (assignedTo.length > 0) params.append('assignedTo', assignedTo.join(','));
    if (excludeMeetingId) params.append('excludeMeetingId', excludeMeetingId);

    const res = await api.get<ApiResponse<MeetingSlotsResponse>>(`/meetings/slots?${params.toString()}`);
    return res.data.data;
  },

  async getById(meetingId: string): Promise<Meeting> {
    const res = await api.get<ApiResponse<Meeting>>(`/meetings/${meetingId}`);
    return res.data.data;
  },

  /** Also raises the meeting's companion task server-side. */
  async create(data: CreateMeetingData): Promise<Meeting> {
    const res = await api.post<ApiResponse<Meeting>>('/meetings', data);
    return res.data.data;
  },

  async update(meetingId: string, data: Partial<CreateMeetingData>): Promise<Meeting> {
    const res = await api.put<ApiResponse<Meeting>>(`/meetings/${meetingId}`, data);
    return res.data.data;
  },

  async setStatus(meetingId: string, status: MeetingStatus, outcome?: string): Promise<Meeting> {
    const res = await api.patch<ApiResponse<Meeting>>(`/meetings/${meetingId}/status`, { status, outcome });
    return res.data.data;
  },

  async remove(meetingId: string): Promise<void> {
    await api.delete(`/meetings/${meetingId}`);
  },

  /** Posts one entry to the "Meeting Purpose" comment thread. */
  async addComment(meetingId: string, text: string): Promise<Meeting> {
    const res = await api.post<ApiResponse<Meeting>>(`/meetings/${meetingId}/comments`, { text });
    return res.data.data;
  },
};
