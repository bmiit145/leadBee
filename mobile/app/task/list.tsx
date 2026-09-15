import React, { useMemo, useState } from 'react';
import { View, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '../../src/theme';
import { taskService } from '../../src/services/task.service';
import { queryKeys } from '../../src/lib/queryKeys';
import { Task, TaskStatus } from '../../src/types';
import { TASK_STATUS_META, TASK_STATUS_ORDER } from '../../src/config/taskMeeting';
import { TaskCard } from '../../src/components/TaskCard';
import { MemberFilter } from '../../src/components/MemberFilter';
import {
  ActiveFilterChips,
  EMPTY_RANGE,
  WorkFilterSheet,
  rangeLabel,
  toDayParam,
  type ActiveFilter,
  type DateRangeValue,
} from '../../src/components/WorkFilterSheet';
import {
  ScreenHeader,
  SearchBar,
  FilterTabs,
  EmptyState,
  SegmentedToggle,
} from '../../src/components/ui';
import { useDebouncedValue } from '../../src/hooks/useDebouncedValue';

const PAGE_SIZE = 20;

export default function TaskListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const [assignBucket, setAssignBucket] = useState(false); // false = My Task
  const [memberId, setMemberId] = useState<string | null>(null);
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim());
  const [range, setRange] = useState<DateRangeValue>(EMPTY_RANGE);
  const [label, setLabel] = useState<string | undefined>();
  const [filterOpen, setFilterOpen] = useState(false);

  const bucket = assignBucket ? ('assigned' as const) : ('mine' as const);

  const labels = useQuery({
    queryKey: [...queryKeys.tasks.all, 'labels'],
    queryFn: () => taskService.getLabels(),
  });

  // A picked member means "that person's tasks". The My/Assign toggle is about
  // the viewer's own relationship to a task, so it has no say then — the API
  // gives `bucket` precedence, which is why it is not sent at all.
  const filters = useMemo(
    () => ({
      ...(memberId ? { assignedTo: memberId } : { bucket }),
      search: search || undefined,
      // A task is in range when it is due in it.
      dateFrom: toDayParam(range.start),
      dateTo: toDayParam(range.end),
      label,
    }),
    [memberId, bucket, search, range, label]
  );

  const list = useInfiniteQuery({
    queryKey: [...queryKeys.tasks.all, 'list', status, filters],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      taskService.getAll({ ...filters, status: status || undefined, page: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });

  // Same filter as the list, without the status, so each tab's number is the
  // rows that tab will show. Under `tasks`, so any task change refreshes it.
  const counts = useQuery({
    queryKey: [...queryKeys.tasks.all, 'counts', filters],
    queryFn: () => taskService.getStats(filters),
  });

  const tasks = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);

  const tabs = [
    { value: '' as TaskStatus | '', label: t('work.all'), count: counts.data?.total },
    ...TASK_STATUS_ORDER.map((s) => ({
      value: s as TaskStatus | '',
      label: t(`work.taskStatus.${s}`),
      color: TASK_STATUS_META[s].color,
      // The API omits statuses nobody has; once counts are in, those read 0.
      count: counts.data ? counts.data[s] ?? 0 : undefined,
    })),
  ];

  const active: ActiveFilter[] = [
    ...(range.start
      ? [{ key: 'range', label: rangeLabel(range) ?? '', onRemove: () => setRange(EMPTY_RANGE) }]
      : []),
    ...(label ? [{ key: 'label', label, onRemove: () => setLabel(undefined) }] : []),
  ];
  const clearFilters = () => {
    setRange(EMPTY_RANGE);
    setLabel(undefined);
  };
  const narrowed = active.length > 0 || !!search;

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={t('work.tasks.title')}
        actions={[
          { icon: 'add', onPress: () => router.push('/task/create'), accessibilityLabel: t('work.tasks.create') },
        ]}
      />

      <View style={styles.controls}>
        <MemberFilter value={memberId} onChange={setMemberId} />
        <SearchBar
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder={t('work.searchPlaceholder')}
          onFilterPress={() => setFilterOpen(true)}
          filterCount={active.length}
        />
        <ActiveFilterChips filters={active} onClearAll={clearFilters} />
        {memberId ? null : (
          <SegmentedToggle
            leftLabel={t('work.tasks.mine')}
            rightLabel={t('work.tasks.assigned')}
            value={assignBucket}
            onChange={setAssignBucket}
          />
        )}
      </View>

      <FilterTabs tabs={tabs} value={status} onChange={setStatus} padCounts />

      {list.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(item: Task) => item._id}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + 24 }}
          refreshing={list.isRefetching && !list.isFetchingNextPage}
          onRefresh={() => {
            list.refetch();
            counts.refetch();
            labels.refetch();
          }}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage();
          }}
          renderItem={({ item }) => <TaskCard task={item} onPress={() => router.push(`/task/${item._id}`)} />}
          ListFooterComponent={
            list.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={{ margin: spacing.md }} /> : null
          }
          ListEmptyComponent={
            list.isError ? (
              <EmptyState title={t('work.loadFailedTitle')} message={t('work.loadFailed')} icon="cloud-offline-outline" />
            ) : (
              <EmptyState
                title={t('work.tasks.empty')}
                message={narrowed ? t('work.tasks.emptyFiltered') : t('work.tasks.emptyTab')}
                icon="clipboard-outline"
              />
            )
          }
        />
      )}

      <WorkFilterSheet
        visible={filterOpen}
        onDismiss={() => setFilterOpen(false)}
        range={range}
        choices={{ label }}
        sections={[
          {
            key: 'label',
            title: t('work.filter.label'),
            options: (labels.data ?? []).map((l) => ({
              value: l.name,
              label: l.name,
              color: l.color,
              count: l.count,
            })),
            emptyText: t('work.filter.noLabels'),
          },
        ]}
        onApply={({ range: nextRange, choices }) => {
          setRange(nextRange);
          setLabel(choices.label);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  controls: { padding: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
});
