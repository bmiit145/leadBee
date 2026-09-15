import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Task, User } from '../types';
import { colors, spacing, borderRadius } from '../theme';
import { TASK_STATUS_META } from '../config/taskMeeting';
import { MemberStack } from './MemberStack';

interface Props {
  task: Task;
  onPress: () => void;
}

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

/**
 * A task in a list. Everything someone scanning their tasks decides on is on
 * the card: what it is, when it runs, where it stands, how much discussion and
 * checklist it carries, and who is on it — so opening a task is to act on it,
 * not to find out what it is.
 */
export function TaskCard({ task, onPress }: Props) {
  const { t } = useTranslation();
  const statusMeta = TASK_STATUS_META[task.status];
  const doneCount = task.checklist.filter((c) => c.done).length;
  const lead = task.leadId && typeof task.leadId === 'object' ? task.leadId : null;
  const members = task.assignedTo.filter((m): m is User => typeof m === 'object');
  const overdue = task.status !== 'completed' && new Date(task.endDate).getTime() < Date.now();

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75} accessibilityRole="button">
      <View style={styles.headerRow}>
        <View style={styles.icon}>
          <Ionicons name="clipboard-outline" size={18} color={colors.primary} />
        </View>
        <View style={styles.titleBlock}>
          <Text style={styles.subject} numberOfLines={1}>
            {task.subject}
          </Text>
          <Text style={styles.number}>{task.taskNumber}</Text>
        </View>
        {overdue ? (
          <View style={styles.overdue}>
            <Text style={styles.overdueText}>{t('work.overdue')}</Text>
          </View>
        ) : null}
      </View>

      {task.description ? (
        <Text style={styles.description} numberOfLines={2}>
          {task.description}
        </Text>
      ) : null}

      <View style={styles.dates}>
        <View style={styles.datePill}>
          <Text style={styles.dateCaption}>{t('work.startDate')}</Text>
          <Text style={styles.dateValue}>{dateLabel(task.startDate)}</Text>
        </View>
        <View style={styles.dash} />
        <View style={styles.datePill}>
          <Text style={styles.dateCaption}>{t('work.endDate')}</Text>
          <Text style={[styles.dateValue, overdue && { color: colors.error }]}>{dateLabel(task.endDate)}</Text>
        </View>
      </View>

      <View style={[styles.statusBar, { backgroundColor: `${statusMeta.color}14`, borderColor: `${statusMeta.color}40` }]}>
        <View style={[styles.statusDot, { backgroundColor: statusMeta.color }]} />
        <Text style={[styles.statusText, { color: statusMeta.color }]}>
          {t(`work.taskStatus.${task.status}`).toUpperCase()}
        </Text>
      </View>

      <View style={styles.footer}>
        <View style={styles.badges}>
          <View
            style={styles.badge}
            accessibilityLabel={t('work.commentCount', { count: task.comments.length })}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={14} color={colors.textSecondary} />
            <Text style={styles.badgeText}>{task.comments.length}</Text>
          </View>
          <View
            style={styles.badge}
            accessibilityLabel={t('work.checklistProgress', { done: doneCount, total: task.checklist.length })}
          >
            <Ionicons name="checkbox-outline" size={14} color={colors.textSecondary} />
            <Text style={styles.badgeText}>
              {doneCount}/{task.checklist.length}
            </Text>
          </View>
          {lead ? (
            <View style={[styles.badge, styles.leadBadge]}>
              <Ionicons name="person-outline" size={13} color={colors.textSecondary} />
              <Text style={styles.badgeText} numberOfLines={1}>
                {lead.contactName}
              </Text>
            </View>
          ) : null}
        </View>
        <MemberStack members={members} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: 10,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: `${colors.primary}0D`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: { flex: 1 },
  subject: { fontSize: 15, fontWeight: '700', color: colors.text },
  number: { fontSize: 11.5, color: colors.textSecondary, marginTop: 1 },
  overdue: {
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: `${colors.error}55`,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  overdueText: { fontSize: 10.5, fontWeight: '800', color: colors.error },
  description: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  dates: { flexDirection: 'row', alignItems: 'center' },
  datePill: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  dateCaption: { fontSize: 10, color: colors.textSecondary },
  dateValue: { fontSize: 12.5, fontWeight: '700', color: colors.text },
  dash: {
    flex: 1,
    height: 0,
    borderTopWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
    marginHorizontal: 6,
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingVertical: 6,
  },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  statusText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, flexWrap: 'wrap' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.background,
    borderRadius: borderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  leadBadge: { maxWidth: 140 },
  badgeText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
});
