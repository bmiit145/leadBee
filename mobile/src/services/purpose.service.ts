import api from './api';
import { ApiResponse } from '../types';

export interface PurposeOfInquiry {
  _id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
}

export const purposeService = {
  async getAll(): Promise<PurposeOfInquiry[]> {
    const res = await api.get<ApiResponse<PurposeOfInquiry[]>>('/purposes');
    return res.data.data;
  },

  async create(name: string): Promise<PurposeOfInquiry> {
    const res = await api.post<ApiResponse<PurposeOfInquiry>>('/purposes', { name });
    return res.data.data;
  },

  async update(id: string, name: string): Promise<PurposeOfInquiry> {
    const res = await api.put<ApiResponse<PurposeOfInquiry>>(`/purposes/${id}`, { name });
    return res.data.data;
  },

  async reorder(orderedIds: string[]): Promise<void> {
    await api.put('/purposes/reorder', { orderedIds });
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/purposes/${id}`);
  },
};
