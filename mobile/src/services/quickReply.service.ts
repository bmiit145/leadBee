import api from './api';
import { ApiResponse, QuickReply } from '../types';

interface QuickReplyInput {
  shortcut: string;
  message: string;
}

/** Personal WhatsApp canned messages, managed from the Lead Details "Quick
 *  Reply" tab. Not lead-scoped — the same list is available on every lead. */
export const quickReplyService = {
  async list(search?: string): Promise<QuickReply[]> {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    const res = await api.get<ApiResponse<QuickReply[]>>(`/quick-replies${qs}`);
    return res.data.data;
  },

  async create(data: QuickReplyInput): Promise<QuickReply> {
    const res = await api.post<ApiResponse<QuickReply>>('/quick-replies', data);
    return res.data.data;
  },

  async update(id: string, data: Partial<QuickReplyInput>): Promise<QuickReply> {
    const res = await api.put<ApiResponse<QuickReply>>(`/quick-replies/${id}`, data);
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/quick-replies/${id}`);
  },
};
