import api from './api';
import { ApiResponse, PaginatedResponse, CallLog } from '../types';

export type CallDirection = 'outgoing' | 'incoming' | 'missed' | 'rejected';

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

export interface CallStats {
  total: { calls: number; seconds: number };
  byDirection: Partial<Record<CallDirection, { calls: number; seconds: number }>>;
}

export interface CallActivity {
  byMember: Array<{ userId: string; name: string; calls: number; seconds: number }>;
  byLead: Array<{ leadId: string; name: string; phone: string; calls: number; seconds: number }>;
}

export interface CallDay {
  day: string;
  calls: number;
  seconds: number;
}

/** One customer number, as the phone needs it to match its own call log. */
export interface LeadPhone {
  leadId: string;
  phone: string;
}

export interface DeviceCallUpload {
  deviceCallId: string;
  leadId: string;
  phoneNumber: string;
  direction: CallDirection;
  calledAt: string;
  durationSeconds?: number;
}

function toParams(filters: CallFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.direction) params.append('direction', filters.direction);
  if (filters.leadId) params.append('leadId', filters.leadId);
  if (filters.calledBy) params.append('calledBy', filters.calledBy);
  if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.append('dateTo', filters.dateTo);
  if (filters.search) params.append('search', filters.search);
  if (filters.page) params.append('page', String(filters.page));
  if (filters.limit) params.append('limit', String(filters.limit));
  return params;
}

export const callService = {
  async getAll(filters: CallFilters = {}): Promise<PaginatedResponse<CallLog>> {
    const res = await api.get<PaginatedResponse<CallLog>>(`/calls?${toParams(filters).toString()}`);
    return res.data;
  },

  async getStats(filters: Omit<CallFilters, 'direction' | 'page' | 'limit'> = {}): Promise<CallStats> {
    const res = await api.get<ApiResponse<CallStats>>(`/calls/stats?${toParams(filters).toString()}`);
    return res.data.data;
  },

  async getDaily(filters: Omit<CallFilters, 'direction' | 'page' | 'limit'> = {}): Promise<CallDay[]> {
    const res = await api.get<ApiResponse<CallDay[]>>(`/calls/daily?${toParams(filters).toString()}`);
    return res.data.data;
  },

  /** Who called most, and which customers were called most, in a range. */
  async getActivity(filters: Omit<CallFilters, 'direction' | 'page' | 'limit'> = {}): Promise<CallActivity> {
    const res = await api.get<ApiResponse<CallActivity>>(`/calls/activity?${toParams(filters).toString()}`);
    return res.data.data;
  },

  /**
   * The customer numbers this member can see. Downloaded so the phone decides
   * on its own which calls belong to a customer — everything else is discarded
   * before any upload (docs/adr/0005-call-tracking.md).
   */
  async getPhoneIndex(): Promise<LeadPhone[]> {
    const res = await api.get<ApiResponse<LeadPhone[]>>('/leads/phone-index');
    return res.data.data;
  },

  /** Idempotent: re-sending a window writes each call once. */
  async sync(calls: DeviceCallUpload[]): Promise<{ written: number; skipped: number }> {
    const res = await api.post<ApiResponse<{ written: number; skipped: number }>>('/calls/sync', { calls });
    return res.data.data;
  },
};
