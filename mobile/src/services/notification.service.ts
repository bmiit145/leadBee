import api from './api';
import { ApiResponse, AppNotification, NotificationEntity, PaginatedResponse } from '../types';

export const notificationService = {
  async list(page: number, limit = 30): Promise<PaginatedResponse<AppNotification>> {
    const res = await api.get<PaginatedResponse<AppNotification>>('/notifications', {
      params: { page, limit },
    });
    return res.data;
  },

  async unreadCount(): Promise<number> {
    const res = await api.get<ApiResponse<{ count: number }>>('/notifications/unread-count');
    return res.data.data.count;
  },

  async markRead(id: string): Promise<void> {
    await api.patch(`/notifications/${id}/read`);
  },

  async markAllRead(): Promise<void> {
    await api.post('/notifications/read-all');
  },
};

/** Where tapping a notification goes — shared by the inbox and a tapped push. */
export function notificationHref(entityType: NotificationEntity, entityId: string): string {
  switch (entityType) {
    case 'lead':
      return `/lead/${entityId}`;
    case 'task':
      return `/task/${entityId}`;
    case 'meeting':
      return `/meeting/${entityId}`;
  }
}
