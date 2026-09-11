import api from './api';
import { ApiResponse, LeadDropReason } from '../types';

/** The tags offered when a lead is closed as lost. Writes are organizer-only on the API. */
export const dropReasonService = {
  async list(): Promise<LeadDropReason[]> {
    const res = await api.get<ApiResponse<LeadDropReason[]>>('/drop-reasons');
    return res.data.data;
  },

  async create(name: string): Promise<LeadDropReason> {
    const res = await api.post<ApiResponse<LeadDropReason>>('/drop-reasons', { name });
    return res.data.data;
  },

  async rename(id: string, name: string): Promise<LeadDropReason> {
    const res = await api.put<ApiResponse<LeadDropReason>>(`/drop-reasons/${id}`, { name });
    return res.data.data;
  },

  /** Deleted outright; leads already dropped with it keep the reason as text. */
  async remove(id: string): Promise<void> {
    await api.delete(`/drop-reasons/${id}`);
  },
};
