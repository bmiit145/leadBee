import React, { useMemo, useState } from 'react';
import { View, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '../../src/theme';
import { ScreenHeader, EmptyState, SegmentedTabs, FilterTabs } from '../../src/components/ui';
import type { FilterTab, SegmentedTab } from '../../src/components/ui';
import { TransferCard } from '../../src/components/transfers/TransferCard';
import { useTransferDecision } from '../../src/components/transfers/useTransferDecision';
import { leadTransferService } from '../../src/services/leadTransfer.service';
import { queryKeys } from '../../src/lib/queryKeys';
import { useAuth } from '../../src/stores/auth.store';
import type { LeadTransfer, LeadTransferBox, LeadTransferStatus } from '../../src/types';

type StatusFilter = LeadTransferStatus | 'any';

const PAGE_SIZE = 20;
const STATUS_FILTERS: StatusFilter[] = ['any', 'pending', 'accepted', 'declined', 'cancelled', 'expired'];

/**
 * Every lead transfer the viewer is party to — what is waiting on them, what
 * they asked for — and, for organizers, the whole team's.
 */
export default function TransferRequestsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, isOrganizer } = useAuth();
  const viewerId = user?._id ?? '';
  const [box, setBox] = useState<LeadTransferBox>('received');
  const [status, setStatus] = useState<StatusFilter>('any');
  const { ask, sheet } = useTransferDecision();

  const pendingCount = useQuery({
    queryKey: queryKeys.transfers.pendingCount,
    queryFn: leadTransferService.pendingCount,
  });

  const query = useInfiniteQuery({
    queryKey: queryKeys.transfers.list(box, status),
    queryFn: ({ pageParam }) =>
      leadTransferService.list({
        box,
        status: status === 'any' ? undefined : status,
        page: pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });
  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.data) ?? [], [query.data]);

  const boxes: SegmentedTab<LeadTransferBox>[] = [
    { value: 'received', label: t('transfers.tabs.received'), count: pendingCount.data },
    { value: 'sent', label: t('transfers.tabs.sent') },
    ...(isOrganizer ? [{ value: 'all' as const, label: t('transfers.tabs.all') }] : []),
  ];
  const statuses: FilterTab<StatusFilter>[] = STATUS_FILTERS.map((value) => ({
    value,
    label: value === 'any' ? t('transfers.anyStatus') : t(`transfers.status.${value}`),
  }));

  /** Where the viewer can open the lead right now; otherwise the card is not a link. */
  const openLeadFor = (transfer: LeadTransfer) => {
    const holdsIt =
      isOrganizer ||
      (transfer.status === 'accepted' ? transfer.toUser : transfer.fromUser) === viewerId;
    return holdsIt ? () => router.push(`/lead/${transfer.lead}`) : undefined;
  };

  const empty = {
    received: ['transfers.empty.receivedTitle', 'transfers.empty.receivedMessage'],
    sent: ['transfers.empty.sentTitle', 'transfers.empty.sentMessage'],
    all: ['transfers.empty.allTitle', 'transfers.empty.allMessage'],
  }[box];

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t('transfers.title')} />

      <View style={styles.filters}>
        <SegmentedTabs tabs={boxes} value={box} onChange={setBox} />
      </View>
      <FilterTabs tabs={statuses} value={status} onChange={setStatus} />

      {query.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : query.isError ? (
        <EmptyState
          icon="cloud-offline-outline"
          title={t('transfers.loadFailed')}
          actionLabel={t('common.tryAgain')}
          onAction={() => query.refetch()}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item._id}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + 24 }}
          refreshing={query.isRefetching}
          onRefresh={() => {
            query.refetch();
            pendingCount.refetch();
          }}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
          }}
          ListFooterComponent={
            query.isFetchingNextPage ? <ActivityIndicator color={colors.primary} /> : null
          }
          renderItem={({ item }) => (
            <TransferCard
              transfer={item}
              viewerId={viewerId}
              isOrganizer={isOrganizer}
              onDecide={ask}
              onOpenLead={openLeadFor(item)}
            />
          )}
          ListEmptyComponent={
            <EmptyState icon="swap-horizontal-outline" title={t(empty[0])} message={t(empty[1])} />
          }
        />
      )}

      {sheet}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  filters: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs },
});
