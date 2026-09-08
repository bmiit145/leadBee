import React, { useMemo, useState } from 'react';
import { View, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { colors, spacing } from '../theme';
import { leadService } from '../services/lead.service';
import { meetingService } from '../services/meeting.service';
import { taskService } from '../services/task.service';
import { Lead, Meeting, Task } from '../types';
import { ReminderFeedItem } from '../components/ReminderFeedItem';
import {
  ScreenHeader,
  SearchBar,
  FolderTabs,
  SegmentedTabs,
  EmptyState,
} from '../components/ui';

type Scope = 'today' | 'tomorrow' | 'overdue';
type Kind = 'lead' | 'meeting' | 'task';

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'overdue', label: 'Overdue' },
];

const EMPTY: Record<Kind, { title: string; icon: keyof typeof Ionicons.glyphMap }> = {
  lead: { title: 'No Leads', icon: 'people-outline' },
  meeting: { title: 'No Meetings', icon: 'people-circle-outline' },
  task: { title: 'No Tasks', icon: 'clipboard-outline' },
};

interface Props {
  /** `menu` opens the Lead drawer (tab usage); `back` pops (pushed usage). */
  leading?: 'back' | 'menu';
  onLeadingPress?: () => void;
}

export function ReminderScreen({ leading = 'back', onLeadingPress }: Props) {
  const insets = useSafeAreaInsets();
  const [scope, setScope] = useState<Scope>('today');
  const [kind, setKind] = useState<Kind>('lead');
  const [search, setSearch] = useState('');

  const leads = useQuery({
    queryKey: ['reminder-leads', scope],
    queryFn: () => leadService.getAll({ reminderScope: scope, limit: 50 }),
  });
  const meetings = useQuery({
    queryKey: ['reminder-meetings', scope],
    queryFn: () =>
      meetingService.getAll(
        scope === 'overdue'
          ? { status: 'scheduled', scope: 'past' }
          : { scope, status: 'scheduled' }
      ),
  });
  const tasks = useQuery({
    queryKey: ['reminder-tasks', scope],
    queryFn: () =>
      taskService.getAll(scope === 'overdue' ? { overdue: true } : { scope: scope as 'today' | 'tomorrow' }),
  });

  const q = search.trim().toLowerCase();

  const data = useMemo(() => {
    if (kind === 'lead') {
      const items = (leads.data?.data ?? []) as Lead[];
      return q
        ? items.filter((l) => l.contactName.toLowerCase().includes(q) || l.contactPhone.includes(q))
        : items;
    }
    if (kind === 'meeting') {
      const items = (meetings.data?.data ?? []) as Meeting[];
      return q
        ? items.filter((m) => {
            const lead = typeof m.leadId === 'object' ? m.leadId : null;
            return lead?.contactName.toLowerCase().includes(q) || lead?.contactPhone.includes(q);
          })
        : items;
    }
    const items = (tasks.data?.data ?? []) as Task[];
    return q ? items.filter((t) => t.subject.toLowerCase().includes(q)) : items;
  }, [kind, q, leads.data, meetings.data, tasks.data]);

  const isLoading =
    (kind === 'lead' && leads.isLoading) ||
    (kind === 'meeting' && meetings.isLoading) ||
    (kind === 'task' && tasks.isLoading);

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Reminder"
        leading={leading}
        onLeadingPress={onLeadingPress}
        actions={[{ icon: 'notifications-outline', onPress: () => {}, accessibilityLabel: 'Notifications' }]}
      >
        <FolderTabs tabs={SCOPES} value={scope} onChange={setScope} />
      </ScreenHeader>

      <View style={styles.body}>
        <SearchBar value={search} onChangeText={setSearch} />

        <SegmentedTabs
          style={{ marginTop: spacing.sm, marginBottom: spacing.md }}
          value={kind}
          onChange={setKind}
          tabs={[
            { value: 'lead', label: 'Lead', count: leads.data?.total ?? 0 },
            { value: 'meeting', label: 'Meeting', count: meetings.data?.total ?? 0 },
            { value: 'task', label: 'Task', count: tasks.data?.total ?? 0 },
          ]}
        />

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : (
          <FlatList
            data={data as any[]}
            keyExtractor={(item) => item._id}
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            renderItem={({ item }) => <ReminderFeedItem kind={kind} item={item} />}
            ListEmptyComponent={
              <EmptyState
                title={EMPTY[kind].title}
                message="Nothing due in this window."
                icon={EMPTY[kind].icon}
              />
            }
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.primary },
  body: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
});
