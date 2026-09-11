import api from './api';
import { Task, TaskStatus, TaskComment, PaginatedResponse, ApiResponse } from '../types';

interface TaskFilters {
  status?: TaskStatus;
  leadId?: string;
  assignedTo?: string;
  bucket?: 'mine' | 'assigned';
  overdue?: boolean;
  scope?: 'today' | 'tomorrow';
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  limit?: number;
}

interface CreateTaskData {
  subject: string;
  description?: string;
  startDate: string;
  endDate: string;
  status?: TaskStatus;
  assignedTo?: string[];
  checklist?: { text: string; done?: boolean }[];
  labels?: { name: string; color: string }[];
  images?: string[];
  leadId?: string;
  /** Comments staged client-side before the task exists (Create Task's "Add
   *  Comments" composer) — sent once, along with creation. */
  comments?: TaskComment[];
}

export const taskService = {
  async getAll(filters: TaskFilters = {}): Promise<PaginatedResponse<Task>> {
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
    if (filters.page) params.append('page', String(filters.page));
    if (filters.limit) params.append('limit', String(filters.limit));

    const res = await api.get<PaginatedResponse<Task>>(`/tasks?${params.toString()}`);
    return res.data;
  },

  /** Counts per status plus `total`, scoped to what the caller can see. */
  async getStats(): Promise<Record<string, number>> {
    // The route is `/stats/status-counts`. The old `/tasks/stats` never existed
    // and fell through to `GET /tasks/:id`, which rejects "stats" as an id.
    const res = await api.get<ApiResponse<Record<string, number>>>('/tasks/stats/status-counts');
    return res.data.data;
  },

  async getById(taskId: string): Promise<Task> {
    const res = await api.get<ApiResponse<Task>>(`/tasks/${taskId}`);
    return res.data.data;
  },

  async create(data: CreateTaskData): Promise<Task> {
    const res = await api.post<ApiResponse<Task>>('/tasks', data);
    return res.data.data;
  },

  async update(taskId: string, data: Partial<CreateTaskData>): Promise<Task> {
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

  async remove(taskId: string): Promise<void> {
    await api.delete(`/tasks/${taskId}`);
  },
};
