import React, { useMemo, useState } from 'react';
import { View, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { colors, spacing } from '../../src/theme';
import { meetingService } from '../../src/services/meeting.service';
import { Meeting } from '../../src/types';
import { MeetingCard } from '../../src/components/MeetingCard';
import { MemberFilter } from '../../src/components/MemberFilter';
import { ScreenHeader, SearchBar, FilterTabs, EmptyState } from '../../src/components/ui';

type Scope = 'all' | 'today' | 'tomorrow' | 'upcoming';

const TABS: { value: Scope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'upcoming', label: 'Upcoming' },
];

export default function MeetingsListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [scope, setScope] = useState<Scope>('all');
  const [memberId, setMemberId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['meetings', scope, memberId],
    queryFn: () =>
      meetingService.getAll({
        ...(scope === 'all' ? {} : { scope }),
        assignedTo: memberId ?? undefined,
      }),
  });

  const meetings = useMemo(() => {
    const items = data?.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((m) => {
      const lead = typeof m.leadId === 'object' ? m.leadId : null;
      return lead?.contactName?.toLowerCase().includes(q) || lead?.contactPhone?.includes(q);
    });
  }, [data, search]);

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Meetings"
        actions={[
          { icon: 'add', onPress: () => router.push('/meeting/create'), accessibilityLabel: 'Create meeting' },
        ]}
      />

      <View style={styles.searchWrap}>
        <MemberFilter value={memberId} onChange={setMemberId} />
        <SearchBar value={search} onChangeText={setSearch} onFilterPress={() => {}} />
      </View>

      <FilterTabs tabs={TABS} value={scope} onChange={setScope} padCounts={false} />

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={meetings}
          keyExtractor={(item: Meeting) => item._id}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + 24 }}
          refreshing={isFetching}
          onRefresh={refetch}
          renderItem={({ item }) => (
            <MeetingCard meeting={item} onPress={() => router.push(`/meeting/${item._id}`)} />
          )}
          ListEmptyComponent={
            <EmptyState title="No Meetings" message="No meetings found for this filter." icon="people-circle-outline" />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  searchWrap: { padding: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
});
