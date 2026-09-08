import api from './api';
import {
  Lead,
  CallLog,
  LeadDashboardStats,
  PaginatedResponse,
  ApiResponse,
  LeadThreadItem,
  LeadThreadChannel,
  LeadDocument,
  LeadDocumentKind,
} from '../types';

interface LeadFilters {
  stage?: string;
  priority?: string;
  source?: string;
  assignedTo?: string;
  project?: string;
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

interface CreateLeadData {
  contactName: string;
  contactPhone: string;
  contactSecondPhone?: string;
  contactEmail?: string;
  source?: string;
  sourceDetail?: string;
  priority?: string;
  stage?: string;
  project?: string;
  interestedIn?: string;
  budgetMin?: number;
  budgetMax?: number;
  preferredConfig?: string;
  address?: string;
  gstNumber?: string;
  assignedTo?: string;
  nextFollowUpAt?: string;
  notes?: string;
}

interface CreateDocumentData {
  kind: LeadDocumentKind;
  name: string;
  url: string;
  mimeType?: string;
  size?: number;
}

interface CreateCallLogData {
  outcome: string;
  duration?: number;
  calledAt?: string;
  notes?: string;
  nextFollowUpAt?: string;
}

export const leadService = {
  async getAll(filters: LeadFilters = {}): Promise<PaginatedResponse<Lead>> {
    const params = new URLSearchParams();
    if (filters.stage) params.append('stage', filters.stage);
    if (filters.priority) params.append('priority', filters.priority);
    if (filters.source) params.append('source', filters.source);
    if (filters.assignedTo) params.append('assignedTo', filters.assignedTo);
    if (filters.project) params.append('project', filters.project);
    if (filters.search) params.append('search', filters.search);
    if (filters.page) params.append('page', String(filters.page));
    if (filters.limit) params.append('limit', String(filters.limit));
    if (filters.overdueFollowUp) params.append('overdueFollowUp', 'true');
    if (filters.reminderScope) params.append('reminderScope', filters.reminderScope);
    if (filters.bookmarked) params.append('bookmarked', 'true');
    if (filters.dateFrom)  params.append('dateFrom',  filters.dateFrom);
    if (filters.dateTo)    params.append('dateTo',    filters.dateTo);
    if (filters.budgetMin !== undefined) params.append('budgetMin', String(filters.budgetMin));
    if (filters.budgetMax !== undefined) params.append('budgetMax', String(filters.budgetMax));

    const res = await api.get<PaginatedResponse<Lead>>(`/leads?${params.toString()}`);
    return res.data;
  },

  async getById(leadId: string): Promise<Lead> {
    const res = await api.get<ApiResponse<Lead>>(`/leads/${leadId}`);
    return res.data.data;
  },

  async create(data: CreateLeadData): Promise<Lead> {
    const res = await api.post<ApiResponse<Lead>>('/leads', data);
    return res.data.data;
  },

  async update(leadId: string, data: Partial<CreateLeadData>): Promise<Lead> {
    const res = await api.put<ApiResponse<Lead>>(`/leads/${leadId}`, data);
    return res.data.data;
  },

  async updateStage(
    leadId: string,
    stage: string,
    opts?: { lostReason?: string; nextFollowUpAt?: string; reminderMinutesBefore?: number[] }
  ): Promise<Lead> {
    const res = await api.put<ApiResponse<Lead>>(`/leads/${leadId}/stage`, { stage, ...opts });
    return res.data.data;
  },

  async assign(leadId: string, assignedTo: string): Promise<Lead> {
    const res = await api.put<ApiResponse<Lead>>(`/leads/${leadId}/assign`, { assignedTo });
    return res.data.data;
  },

  async toggleBookmark(leadId: string): Promise<Lead> {
    const res = await api.patch<ApiResponse<Lead>>(`/leads/${leadId}/bookmark`);
    return res.data.data;
  },

  async remove(leadId: string): Promise<void> {
    await api.delete(`/leads/${leadId}`);
  },

  async getCallLogs(leadId: string, page = 1, limit = 20): Promise<PaginatedResponse<CallLog>> {
    const res = await api.get<PaginatedResponse<CallLog>>(
      `/leads/${leadId}/call-logs?page=${page}&limit=${limit}`
    );
    return res.data;
  },

  async addCallLog(leadId: string, data: CreateCallLogData): Promise<CallLog> {
    const res = await api.post<ApiResponse<CallLog>>(`/leads/${leadId}/call-logs`, data);
    return res.data.data;
  },

  async getDashboardStats(project?: string): Promise<LeadDashboardStats> {
    const params = project ? `?project=${project}` : '';
    const res = await api.get<ApiResponse<LeadDashboardStats>>(`/leads/stats/dashboard${params}`);
    return res.data.data;
  },

  // ─── Threads: Time Line / Notes / Ask Query ───────────────────────────────

  async getThread(
    leadId: string,
    channel: LeadThreadChannel,
    page = 1,
    limit = 30,
  ): Promise<PaginatedResponse<LeadThreadItem>> {
    const res = await api.get<PaginatedResponse<LeadThreadItem>>(
      `/leads/${leadId}/thread?channel=${channel}&page=${page}&limit=${limit}`,
    );
    return res.data;
  },

  async addThreadItem(
    leadId: string,
    channel: LeadThreadChannel,
    text: string,
  ): Promise<LeadThreadItem> {
    const res = await api.post<ApiResponse<LeadThreadItem>>(`/leads/${leadId}/thread`, { channel, text });
    return res.data.data;
  },

  async updateThreadItem(leadId: string, itemId: string, text: string): Promise<LeadThreadItem> {
    const res = await api.put<ApiResponse<LeadThreadItem>>(`/leads/${leadId}/thread/${itemId}`, { text });
    return res.data.data;
  },

  async toggleThreadResolved(leadId: string, itemId: string): Promise<LeadThreadItem> {
    const res = await api.patch<ApiResponse<LeadThreadItem>>(`/leads/${leadId}/thread/${itemId}/resolve`);
    return res.data.data;
  },

  async deleteThreadItem(leadId: string, itemId: string): Promise<void> {
    await api.delete(`/leads/${leadId}/thread/${itemId}`);
  },

  // ─── Documents / Attachments ─────────────────────────────────────────────

  async getDocuments(leadId: string, kind?: LeadDocumentKind): Promise<LeadDocument[]> {
    const qs = kind ? `?kind=${kind}` : '';
    const res = await api.get<ApiResponse<LeadDocument[]>>(`/leads/${leadId}/documents${qs}`);
    return res.data.data;
  },

  async addDocument(leadId: string, data: CreateDocumentData): Promise<LeadDocument> {
    const res = await api.post<ApiResponse<LeadDocument>>(`/leads/${leadId}/documents`, data);
    return res.data.data;
  },

  async deleteDocument(leadId: string, docId: string): Promise<void> {
    await api.delete(`/leads/${leadId}/documents/${docId}`);
  },
};
