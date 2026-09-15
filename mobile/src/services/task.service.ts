import api from './api';
import { Task, TaskStatus, PaginatedResponse, ApiResponse } from '../types';

export interface TaskFilters {
  status?: TaskStatus;
  leadId?: string;
  assignedTo?: string;
  bucket?: 'mine' | 'assigned';
  overdue?: boolean;
  scope?: 'today' | 'tomorrow';
  dateFrom?: string;
  dateTo?: string;
  /** Subject, task number, or the customer name/number of the task's lead. */
  search?: string;
  /** A label's name. */
  label?: string;
  page?: number;
  limit?: number;
}

export interface TaskLabelSummary {
  name: string;
  color: string;
  count: number;
}

export interface TaskFormData {
  subject: string;
  description?: string;
  startDate: string;
  endDate: string;
  status?: TaskStatus;
  assignedTo?: string[];
  /** On edit, existing items keep their `_id` so their ticks survive. */
  checklist?: { _id?: string; text: string; done?: boolean }[];
  labels?: { name: string; color: string }[];
  images?: string[];
  leadId?: string;
  /** Comments typed on the create form before the task exists — sent once, with creation. */
  comments?: { text: string }[];
}

function toParams(filters: TaskFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status) params.append('status', filters.status);
  if (filters.leadId) params.append('leadId', filters.leadId);
  if (filters.assignedTo) params.append('assignedTo', filters.assignedTo);
  if (filters.bucket) params.append('bucket', filters.bucket);
  if (filters.overdue) params.append('overdue', 'true');
  if (filters.scope) params.append('scope', filters.scope);
  if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.append('dateTo', filters.dateTo);
  if (filters.search) params.append('search', filters.search);
  if (filters.label) params.append('label', filters.label);
  if (filters.page) params.append('page', String(filters.page));
  if (filters.limit) params.append('limit', String(filters.limit));
  return params;
}

export const taskService = {
  async getAll(filters: TaskFilters = {}): Promise<PaginatedResponse<Task>> {
    const res = await api.get<PaginatedResponse<Task>>(`/tasks?${toParams(filters).toString()}`);
    return res.data;
  },

  /**
   * Counts per status plus `total`. Pass the list's own filters so the tab
   * counts describe the rows under them.
   */
  async getStats(
    filters: Omit<TaskFilters, 'status' | 'page' | 'limit'> = {}
  ): Promise<Record<string, number>> {
    const res = await api.get<ApiResponse<Record<string, number>>>(
      `/tasks/stats/status-counts?${toParams(filters).toString()}`
    );
    return res.data.data;
  },

  /** Labels used on the tasks the caller can see, for the filter. */
  async getLabels(): Promise<TaskLabelSummary[]> {
    const res = await api.get<ApiResponse<TaskLabelSummary[]>>('/tasks/labels');
    return res.data.data;
  },

  async getById(taskId: string): Promise<Task> {
    const res = await api.get<ApiResponse<Task>>(`/tasks/${taskId}`);
    return res.data.data;
  },

  async create(data: TaskFormData): Promise<Task> {
    const res = await api.post<ApiResponse<Task>>('/tasks', data);
    return res.data.data;
  },

  /** Its creator or an organizer. `leadId: null` unlinks the lead. */
  async update(
    taskId: string,
    data: Partial<Omit<TaskFormData, 'comments' | 'leadId'>> & { leadId?: string | null }
  ): Promise<Task> {
    const res = await api.put<ApiResponse<Task>>(`/tasks/${taskId}`, data);
    return res.data.data;
  },

  async setStatus(taskId: string, status: TaskStatus): Promise<Task> {
    const res = await api.patch<ApiResponse<Task>>(`/tasks/${taskId}/status`, { status });
    return res.data.data;
  },

  async addComment(taskId: string, text: string): Promise<Task> {
    const res = await api.post<ApiResponse<Task>>(`/tasks/${taskId}/comments`, { text });
    return res.data.data;
  },

  async toggleChecklistItem(taskId: string, itemId: string): Promise<Task> {
    const res = await api.patch<ApiResponse<Task>>(`/tasks/${taskId}/checklist/${itemId}`);
    return res.data.data;
  },

  /** Its creator or an organizer. */
  async remove(taskId: string): Promise<void> {
    await api.delete(`/tasks/${taskId}`);
  },
};
