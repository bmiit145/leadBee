import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { meetingService } from '../services/meeting.service';
import { taskService } from '../services/task.service';
import { queryKeys } from '../lib/queryKeys';
import { MeetingCard } from './MeetingCard';
import { TaskCard } from './TaskCard';
import { colors, spacing, borderRadius } from '../theme';

/** Enough for one lead; a lead with more work than this is opened from the full lists. */
const PER_LEAD_LIMIT = 50;

/**
 * The "Meetings & Tasks" tab on a lead: every meeting and task on it, whoever
 * they are assigned to, with shortcuts to add more. Meetings and tasks could
 * be created from a lead but never seen from it again.
 *
 * Keys sit under `meetings` and `tasks`, so creating, editing or completing
 * either anywhere in the app refreshes this tab too.
 */
export function LeadWorkPanel({ leadId }: { leadId: string }) {
  const router = useRouter();
  const { t } = useTranslation();

  const meetings = useQuery({
    queryKey: [...queryKeys.meetings.all, 'lead', leadId],
    queryFn: () => meetingService.getAll({ leadId, limit: PER_LEAD_LIMIT }),
  });
  const tasks = useQuery({
    queryKey: [...queryKeys.tasks.all, 'lead', leadId],
    queryFn: () => taskService.getAll({ leadId, limit: PER_LEAD_LIMIT }),
  });

  return (
    <View style={styles.wrap}>
      <Section
        title={t('leadWork.meetings', { count: meetings.data?.total ?? 0 })}
        actionLabel={t('leadWork.schedule')}
        onAction={() => router.push(`/meeting/create?leadId=${leadId}`)}
      >
        {meetings.isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : meetings.isError ? (
          <Text style={styles.empty}>{t('leadWork.loadFailed')}</Text>
        ) : (meetings.data?.data ?? []).length === 0 ? (
          <Text style={styles.empty}>{t('leadWork.noMeetings')}</Text>
        ) : (
          meetings.data!.data.map((meeting) => (
            <MeetingCard
              key={meeting._id}
              meeting={meeting}
              onPress={() => router.push(`/meeting/${meeting._id}`)}
            />
          ))
        )}
      </Section>

      <Section
        title={t('leadWork.tasks', { count: tasks.data?.total ?? 0 })}
        actionLabel={t('leadWork.addTask')}
        onAction={() => router.push(`/task/create?leadId=${leadId}`)}
      >
        {tasks.isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : tasks.isError ? (
          <Text style={styles.empty}>{t('leadWork.loadFailed')}</Text>
        ) : (tasks.data?.data ?? []).length === 0 ? (
          <Text style={styles.empty}>{t('leadWork.noTasks')}</Text>
        ) : (
          tasks.data!.data.map((task) => (
            <TaskCard key={task._id} task={task} onPress={() => router.push(`/task/${task._id}`)} />
          ))
        )}
      </Section>
    </View>
  );
}

function Section({
  title,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  actionLabel: string;
  onAction: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <TouchableOpacity
          style={styles.action}
          onPress={onAction}
          activeOpacity={0.75}
          accessibilityRole="button"
        >
          <Ionicons name="add" size={16} color={colors.primary} />
          <Text style={styles.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
  section: { gap: spacing.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  actionText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  loader: { marginVertical: spacing.md },
  empty: { fontSize: 13, color: colors.textSecondary, paddingVertical: spacing.sm },
});
