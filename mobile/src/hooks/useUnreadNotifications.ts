import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../stores/auth.store';
import { notificationService } from '../services/notification.service';
import { queryKeys } from '../lib/queryKeys';

const POLL_MS = 60_000;

/**
 * Unread notification count, for the bell badge.
 *
 * Polled rather than driven by push. Push is not guaranteed — the user may have
 * denied the permission, or the build may not have push configured yet — and a
 * badge that only moves when a push arrives would sit at zero for exactly those
 * users.
 */
export function useUnreadNotifications(): number {
  const { isAuthenticated } = useAuth();
  const { data } = useQuery({
    queryKey: queryKeys.notifications.unreadCount,
    queryFn: () => notificationService.unreadCount(),
    enabled: isAuthenticated,
    refetchInterval: POLL_MS,
    staleTime: POLL_MS / 2,
  });
  return data ?? 0;
}
