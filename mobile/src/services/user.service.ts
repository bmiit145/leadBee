import api from './api';
import { ApiResponse, PaginatedResponse, UserRole } from '../types';

export interface TeamMember {
  _id: string;
  name: string;
  phone: string;
  email?: string;
  role: UserRole;
  /** Populated with the role's name when the member is on a custom role. */
  roleId?: { _id: string; name: string } | string;
  designation?: string;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt?: string;
}

export interface NewTeamMember {
  name: string;
  phone: string;
  email?: string;
  password: string;
  role: UserRole;
  designation?: string;
}

/** Only what changed. `role` is left out unless it changed: the API refuses any
 *  role field on your own account, even one that matches. */
export interface TeamMemberChanges {
  name?: string;
  email?: string;
  designation?: string;
  role?: UserRole;
}

/** The API's page ceiling. */
const MAX_PAGE = 100;

export const userService = {
  /**
   * Active members, for assignment pickers and member filters.
   *
   * Asks for the API's full page: the default of 20 silently dropped everyone
   * after the twentieth name from every picker.
   */
  async list(): Promise<TeamMember[]> {
    const res = await api.get<PaginatedResponse<TeamMember>>('/users', {
      params: { limit: MAX_PAGE },
    });
    return res.data.data;
  },

  async listPage(params: {
    isActive: boolean;
    search?: string;
    page: number;
    limit: number;
  }): Promise<PaginatedResponse<TeamMember>> {
    const res = await api.get<PaginatedResponse<TeamMember>>('/users', { params });
    return res.data;
  },

  async getById(id: string): Promise<TeamMember> {
    const res = await api.get<ApiResponse<TeamMember>>(`/users/${id}`);
    return res.data.data;
  },

  async create(input: NewTeamMember): Promise<TeamMember> {
    const res = await api.post<ApiResponse<TeamMember>>('/users', input);
    return res.data.data;
  },

  async update(id: string, changes: TeamMemberChanges): Promise<TeamMember> {
    const res = await api.put<ApiResponse<TeamMember>>(`/users/${id}`, changes);
    return res.data.data;
  },

  /** Deactivating signs the member out everywhere; activating takes a seat. */
  async setActive(id: string, isActive: boolean): Promise<TeamMember> {
    const res = await api.patch<ApiResponse<TeamMember>>(`/users/${id}/active`, { isActive });
    return res.data.data;
  },

  async resetPassword(id: string, newPassword: string): Promise<void> {
    await api.post(`/users/${id}/reset-password`, { newPassword });
  },
};
