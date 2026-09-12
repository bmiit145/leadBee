import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationHref, notificationService } from '../src/services/notification.service';
import { apiErrorMessage } from '../src/services/api';
import { queryKeys } from '../src/lib/queryKeys';
import { EmptyState, ScreenHeader } from '../src/components/ui';
import type { AppNotification, NotificationEntity } from '../src/types';
import { formatDate, formatTime } from '../src/utils/format';
import { colors, spacing, borderRadius, shadows } from '../src/theme';

const ENTITY_ICONS: Record<NotificationEntity, React.ComponentProps<typeof Ionicons>['name']> = {
  lead: 'person-add-outline',
  task: 'clipboard-outline',
  meeting: 'calendar-outline',
};

/**
 * The inbox: what was assigned to you, and by whom.
 *
 * Rows are translated here from the event type — the API stores what happened,
 * never a sentence — so the list reads in the app's language.
 */
export default function NotificationsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const feed = useInfiniteQuery({
    queryKey: [...queryKeys.notifications.all, 'feed'],
    queryFn: ({ pageParam }) => notificationService.list(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });

  const refreshInbox = () => qc.invalidateQueries({ queryKey: queryKeys.notifications.all });

  const markAll = useMutation({
    mutationFn: () => notificationService.markAllRead(),
    onSuccess: () => void refreshInbox(),
    onError: (error) => Alert.alert(t('common.error'), apiErrorMessage(error, t('notifications.markFailed'))),
  });

  const rows = feed.data?.pages.flatMap((page) => page.data) ?? [];
  const hasUnread = rows.some((row) => !row.readAt);

  const open = (item: AppNotification) => {
    // Navigation does not wait on the read receipt: a slow network must not
    // make the tap feel dead, and an unread dot that lingers is harmless.
    if (!item.readAt) {
      notificationService
        .markRead(item._id)
        .then(() => refreshInbox())
        .catch(() => undefined);
    }
    router.push(notificationHref(item.entityType, item.entityId));
  };

  const renderItem = ({ item }: { item: AppNotification }) => {
    const isUnread = !item.readAt;
    const sentOn = formatDate(item.createdAt, { day: 'numeric', month: 'short' });
    const sentAt = formatTime(item.createdAt);
    const happensOn = formatDate(item.at, { day: 'numeric', month: 'short' });
    const happensAt = formatTime(item.at);

    return (
      <TouchableOpacity
        style={[styles.row, isUnread && styles.rowUnread]}
        onPress={() => open(item)}
        activeOpacity={0.8}
        accessibilityRole="button"
      >
        <View style={[styles.iconWrap, isUnread && styles.iconWrapUnread]}>
          <Ionicons
            name={ENTITY_ICONS[item.entityType] ?? 'notifications-outline'}
            size={20}
            color={isUnread ? '#FFFFFF' : colors.text}
          />
        </View>
        <View style={styles.body}>
          <Text style={[styles.text, isUnread && styles.textUnread]}>
            {t(`notifications.types.${item.type}`, {
              actor: item.actorName,
              subject: item.subject,
              defaultValue: item.subject,
            })}
          </Text>
          {item.entityType === 'meeting' && happensOn && happensAt ? (
            <Text style={styles.detail}>
              {t('notifications.meetingAt', { date: happensOn, time: happensAt })}
            </Text>
          ) : null}
          {sentOn && sentAt ? <Text style={styles.time}>{`${sentOn} · ${sentAt}`}</Text> : null}
        </View>
        {isUnread ? <View style={styles.unreadDot} accessibilityLabel={t('notifications.unread')} /> : null}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={t('notifications.title')}
        actions={
          hasUnread
            ? [
                {
                  icon: 'checkmark-done-outline',
                  onPress: () => markAll.mutate(),
                  accessibilityLabel: t('notifications.markAllRead'),
                },
              ]
            : []
        }
      />

      {feed.isLoading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : feed.isError ? (
        <EmptyState
          icon="cloud-offline-outline"
          title={t('notifications.loadFailed')}
          actionLabel={t('common.tryAgain')}
          onAction={() => void feed.refetch()}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item._id}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]}
          onEndReached={() => {
            if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
          }}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={feed.isRefetching && !feed.isFetchingNextPage}
              onRefresh={() => void refreshInbox()}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListFooterComponent={
            feed.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="notifications-off-outline"
              title={t('notifications.emptyTitle')}
              message={t('notifications.emptyMessage')}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  loader: { marginVertical: spacing.xl },
  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    ...shadows.sm,
  },
  rowUnread: { borderLeftWidth: 3, borderLeftColor: colors.primary },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceVariant,
  },
  iconWrapUnread: { backgroundColor: colors.primary },
  body: { flex: 1, gap: 3 },
  text: { fontSize: 14, color: colors.text, lineHeight: 20 },
  textUnread: { fontWeight: '700' },
  detail: { fontSize: 13, color: colors.textSecondary },
  time: { fontSize: 12, color: colors.textTertiary },
  unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.error, marginTop: 6 },
});
