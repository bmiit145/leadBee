import React, { useMemo, useState } from 'react';
import { View, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '../../src/theme';
import { meetingService, type MeetingTab } from '../../src/services/meeting.service';
import { purposeService } from '../../src/services/purpose.service';
import { queryKeys } from '../../src/lib/queryKeys';
import { Meeting, MeetingType } from '../../src/types';
import {
  MEETING_STATUS_META,
  MEETING_TYPE_ORDER,
  MISSED_COLOR,
} from '../../src/config/taskMeeting';
import { MeetingCard } from '../../src/components/MeetingCard';
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
import { ScreenHeader, SearchBar, FilterTabs, EmptyState } from '../../src/components/ui';
import { useDebouncedValue } from '../../src/hooks/useDebouncedValue';

const TAB_ORDER: MeetingTab[] = [
  'all',
  'today',
  'tomorrow',
  'upcoming',
  'completed',
  'cancelled',
  'rescheduled',
  'missed',
];

const TAB_COLOR: Partial<Record<MeetingTab, string>> = {
  completed: MEETING_STATUS_META.completed.color,
  cancelled: MEETING_STATUS_META.cancelled.color,
  rescheduled: MEETING_STATUS_META.rescheduled.color,
  missed: MISSED_COLOR,
};

const PAGE_SIZE = 20;

export default function MeetingsListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const [tab, setTab] = useState<MeetingTab>('all');
  const [memberId, setMemberId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim());
  const [range, setRange] = useState<DateRangeValue>(EMPTY_RANGE);
  const [meetingType, setMeetingType] = useState<MeetingType | undefined>();
  const [purpose, setPurpose] = useState<string | undefined>();
  const [filterOpen, setFilterOpen] = useState(false);

  const purposes = useQuery({ queryKey: queryKeys.lookups.purposes, queryFn: () => purposeService.getAll() });

  // Everything but the tab — shared by the rows and the tab counts, so they agree.
  const filters = useMemo(
    () => ({
      assignedTo: memberId ?? undefined,
      search: search || undefined,
      dateFrom: toDayParam(range.start),
      dateTo: toDayParam(range.end),
      meetingType,
      purpose,
    }),
    [memberId, search, range, meetingType, purpose]
  );

  const list = useInfiniteQuery({
    queryKey: [...queryKeys.meetings.all, 'list', tab, filters],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      meetingService.getAll({
        ...filters,
        ...(tab === 'all' ? {} : { scope: tab }),
        page: pageParam,
        limit: PAGE_SIZE,
      }),
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });

  const counts = useQuery({
    queryKey: [...queryKeys.meetings.all, 'tab-counts', filters],
    queryFn: () => meetingService.getTabCounts(filters),
  });

  const meetings = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);

  const tabs = TAB_ORDER.map((value) => ({
    value,
    label: t(`work.meetingTabs.${value}`),
    count: counts.data?.[value],
    color: TAB_COLOR[value],
  }));

  const purposeName = purposes.data?.find((p) => p._id === purpose)?.name;
  const active: ActiveFilter[] = [
    ...(range.start
      ? [{ key: 'range', label: rangeLabel(range) ?? '', onRemove: () => setRange(EMPTY_RANGE) }]
      : []),
    ...(meetingType
      ? [{ key: 'type', label: t(`work.meetingType.${meetingType}`), onRemove: () => setMeetingType(undefined) }]
      : []),
    ...(purpose
      ? [{ key: 'purpose', label: purposeName ?? t('work.filter.purpose'), onRemove: () => setPurpose(undefined) }]
      : []),
  ];

  const clearFilters = () => {
    setRange(EMPTY_RANGE);
    setMeetingType(undefined);
    setPurpose(undefined);
  };

  const narrowed = active.length > 0 || !!search;

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={t('work.meetings.title')}
        actions={[
          {
            icon: 'add',
            onPress: () => router.push('/meeting/create'),
            accessibilityLabel: t('work.meetings.create'),
          },
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
      </View>

      <FilterTabs tabs={tabs} value={tab} onChange={setTab} padCounts />

      {list.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={meetings}
          keyExtractor={(item: Meeting) => item._id}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + 24 }}
          refreshing={list.isRefetching && !list.isFetchingNextPage}
          onRefresh={() => {
            list.refetch();
            counts.refetch();
          }}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage();
          }}
          renderItem={({ item }) => (
            <MeetingCard meeting={item} onPress={() => router.push(`/meeting/${item._id}`)} />
          )}
          ListFooterComponent={
            list.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={{ margin: spacing.md }} /> : null
          }
          ListEmptyComponent={
            list.isError ? (
              <EmptyState
                title={t('work.loadFailedTitle')}
                message={t('work.loadFailed')}
                icon="cloud-offline-outline"
              />
            ) : (
              <EmptyState
                title={t('work.meetings.empty')}
                message={narrowed ? t('work.meetings.emptyFiltered') : t('work.meetings.emptyTab')}
                icon="people-circle-outline"
              />
            )
          }
        />
      )}

      <WorkFilterSheet
        visible={filterOpen}
        onDismiss={() => setFilterOpen(false)}
        range={range}
        choices={{ meetingType, purpose }}
        sections={[
          {
            key: 'meetingType',
            title: t('work.filter.meetingType'),
            options: MEETING_TYPE_ORDER.map((type) => ({
              value: type,
              label: t(`work.meetingType.${type}`),
            })),
          },
          {
            key: 'purpose',
            title: t('work.filter.purpose'),
            options: (purposes.data ?? []).map((p) => ({ value: p._id, label: p.name })),
            emptyText: t('work.filter.noPurposes'),
          },
        ]}
        onApply={({ range: nextRange, choices }) => {
          setRange(nextRange);
          setMeetingType(choices.meetingType as MeetingType | undefined);
          setPurpose(choices.purpose);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  controls: { padding: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
});
