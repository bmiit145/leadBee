import React, { useState } from 'react';
import { View, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { colors, spacing } from '../../src/theme';
import { taskService } from '../../src/services/task.service';
import { Task, TaskStatus } from '../../src/types';
import { TASK_STATUS_META, TASK_STATUS_ORDER } from '../../src/config/taskMeeting';
import { TaskCard } from '../../src/components/TaskCard';
import {
  ScreenHeader,
  SearchBar,
  FilterTabs,
  EmptyState,
  SegmentedToggle,
} from '../../src/components/ui';

const STATUS_TABS = [
  { value: '' as TaskStatus | '', label: 'All' },
  ...TASK_STATUS_ORDER.map((s) => ({
    value: s,
    label: TASK_STATUS_META[s].label,
    color: TASK_STATUS_META[s].color,
  })),
];

export default function TaskListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [assignBucket, setAssignBucket] = useState(false); // false = My Task
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [search, setSearch] = useState('');

  const bucket = assignBucket ? 'assigned' : 'mine';

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['tasks', bucket, status, search],
    queryFn: () => taskService.getAll({ bucket, status: status || undefined, search: search || undefined }),
  });

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="All Tasks"
        actions={[
          { icon: 'add', onPress: () => router.push('/task/create'), accessibilityLabel: 'Create task' },
        ]}
      />

      <View style={styles.controls}>
        <SearchBar value={search} onChangeText={setSearch} onFilterPress={() => {}} />
        <SegmentedToggle
          leftLabel="My Task"
          rightLabel="Assign Task"
          value={assignBucket}
          onChange={setAssignBucket}
        />
      </View>

      <FilterTabs tabs={STATUS_TABS} value={status} onChange={setStatus} padCounts={false} />

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={data?.data ?? []}
          keyExtractor={(item: Task) => item._id}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + 24 }}
          refreshing={isFetching}
          onRefresh={refetch}
          renderItem={({ item }) => (
            <TaskCard task={item} onPress={() => router.push(`/task/${item._id}`)} />
          )}
          ListEmptyComponent={
            <EmptyState title="No Tasks" message="No tasks found for this filter." icon="clipboard-outline" />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  controls: { padding: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
});
