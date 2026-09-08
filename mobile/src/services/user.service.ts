import api from './api';
import { ApiResponse } from '../types';

export interface TeamMember {
  _id: string;
  name: string;
  phone: string;
  email?: string;
  role: string;
}

export const userService = {
  /** Team-member list for assignment pickers (Meeting/Task "Select Members"). */
  async list(): Promise<TeamMember[]> {
    const res = await api.get<ApiResponse<TeamMember[]>>('/users');
    return res.data.data;
  },
};
