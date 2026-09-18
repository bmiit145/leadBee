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
  LibraryDocument,
  LeadStage,
} from '../types';

interface LeadFilters {
  stage?: string;
  priority?: string;
  source?: string;
  assignedTo?: string;
  project?: string;
  /** Purpose of Inquiry, by name. */
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

export interface CreateLeadData {
  contactName: string;
  contactPhone: string;
  contactSecondPhone?: string;
  contactEmail?: string;
  source?: string;
  sourceDetail?: string;
  priority?: string;
  stage?: string;
  /** Required with `stage: 'drop'`. */
  lostReason?: string;
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
  /** Sent after the person has seen the duplicate warning and chosen to go ahead. */
  allowDuplicate?: boolean;
}

/** One live lead that already holds the number being entered. */
export interface DuplicateMatch {
  leadNumber: string;
  stage: LeadStage;
  createdAt: string;
  /** The lead's number that matched — its main one or its second. */
  matchedPhone: string;
  assignedToName?: string;
  /** Who created it. */
  createdByName?: string;
  /** Present only when the caller may open the lead. */
  leadId?: string;
  contactName?: string;
  canView: boolean;
}

/** Every match (up to a limit) and how many there are in all. */
export interface DuplicateResult {
  total: number;
  matches: DuplicateMatch[];
}

/**
 * `error.details` of a 409 `DUPLICATE_LEAD`. The top-level fields describe the
 * first match, for older builds; `matches` and `total` carry all of them.
 * `leadId` is present only when the caller can open that lead.
 */
export interface DuplicateLeadDetails extends Partial<DuplicateResult> {
  leadNumber: string;
  assignedToName?: string;
  leadId?: string;
  contactName?: string;
}

interface CreateDocumentData {
  kind: LeadDocumentKind;
  name: string;
  url: string;
  mimeType?: string;
  size?: number;
}

export interface CallLogData {
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
    if (filters.interestedIn) params.append('interestedIn', filters.interestedIn);
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
    if (filters.deleted) params.append('deleted', 'true');

    const res = await api.get<PaginatedResponse<Lead>>(`/leads?${params.toString()}`);
    return res.data;
  },

  async getById(leadId: string): Promise<Lead> {
    const res = await api.get<ApiResponse<Lead>>(`/leads/${leadId}`);
    return res.data.data;
  },

  /** Rejects with 409 `DUPLICATE_LEAD` when the number is taken, unless `allowDuplicate` is set. */
  async create(data: CreateLeadData): Promise<Lead> {
    const res = await api.post<ApiResponse<Lead>>('/leads', data);
    return res.data.data;
  },

  /** Stage is not accepted here — use `updateStage`. */
  async update(leadId: string, data: Partial<Omit<CreateLeadData, 'stage'>>): Promise<Lead> {
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

  /** Organizers only. Also archives the lead's tasks and meetings. */
  async remove(leadId: string): Promise<void> {
    await api.delete(`/leads/${leadId}`);
  },

  /** Organizers only. Brings back the lead and the work archived with it. */
  async restore(leadId: string): Promise<Lead> {
    const res = await api.post<ApiResponse<Lead>>(`/leads/${leadId}/restore`);
    return res.data.data;
  },

  /**
   * Live leads already holding these numbers — checked while a number is typed,
   * so the person learns before they fill the rest of the form.
   */
  async findDuplicates(
    phone: string,
    secondPhone?: string,
    excludeId?: string
  ): Promise<DuplicateResult> {
    const params = new URLSearchParams({ phone });
    if (secondPhone) params.append('secondPhone', secondPhone);
    if (excludeId) params.append('excludeId', excludeId);
    const res = await api.get<ApiResponse<DuplicateResult>>(`/leads/duplicates?${params.toString()}`);
    return res.data.data;
  },

  async getCallLogs(leadId: string, page = 1, limit = 20): Promise<PaginatedResponse<CallLog>> {
    const res = await api.get<PaginatedResponse<CallLog>>(
      `/leads/${leadId}/call-logs?page=${page}&limit=${limit}`
    );
    return res.data;
  },

  /** `assignedTo` narrows the counts to one member's book — organizers only; the
   *  API ignores it for anyone else. */
  async getDashboardStats(
    filters: { project?: string; assignedTo?: string } = {}
  ): Promise<LeadDashboardStats> {
    const res = await api.get<ApiResponse<LeadDashboardStats>>('/leads/stats/dashboard', {
      params: filters,
    });
    return res.data.data;
  },

  /** Every document and attachment the caller can reach, across leads. */
  async getDocumentLibrary(filters: {
    kind?: LeadDocumentKind;
    search?: string;
    page: number;
    limit: number;
  }): Promise<PaginatedResponse<LibraryDocument>> {
    const res = await api.get<PaginatedResponse<LibraryDocument>>('/leads/documents', {
      params: filters,
    });
    return res.data;
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
