import api from './api';
import { ApiResponse, PaginatedResponse, QuickReply } from '../types';

interface QuickReplyInput {
  shortcut: string;
  message: string;
}

/** The API's page ceiling. A personal canned-message list longer than this is
 *  one nobody scrolls; search is the way in. */
const MAX_PAGE = 100;

/** Personal WhatsApp canned messages, managed from the Lead Details "Quick
 *  Reply" tab and the drawer. Not lead-scoped — the same list is on every lead. */
export const quickReplyService = {
  async list(search?: string): Promise<QuickReply[]> {
    const res = await api.get<PaginatedResponse<QuickReply>>('/quick-replies', {
      params: { limit: MAX_PAGE, ...(search ? { search } : {}) },
    });
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
