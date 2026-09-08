import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Task } from '../types';
import { colors, spacing, borderRadius } from '../theme';
import { TASK_STATUS_META } from '../config/taskMeeting';
import { StatusChip, Avatar } from './ui';

interface Props {
  task: Task;
  onPress: () => void;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Card for a fully standalone task (no leadId, no meetingId) — not directly
 * observed in the reference app's screenshot pack (every captured task there
 * was either meeting- or lead-linked), so this follows the same visual
 * language as LeadCard/MeetingCard rather than a confirmed design: avatar,
 * subject, status chip, START/END dates, and a checklist-progress footer.
 */
export function TaskCard({ task, onPress }: Props) {
  const statusMeta = TASK_STATUS_META[task.status];
  const doneCount = task.checklist.filter((c) => c.done).length;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.headerRow}>
        <Avatar icon="clipboard" size={34} />
        <Text style={styles.subject} numberOfLines={1}>{task.subject}</Text>
        <StatusChip label={statusMeta.label} color={statusMeta.color} />
      </View>

      <View style={styles.divider} />

      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>START</Text>
        <Text style={styles.metaColon}>:</Text>
        <Text style={styles.metaValue}>{fmt(task.startDate)}</Text>
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>END</Text>
        <Text style={styles.metaColon}>:</Text>
        <Text style={styles.metaValue}>{fmt(task.endDate)}</Text>
      </View>

      {task.checklist.length > 0 && (
        <View style={styles.checklistRow}>
          <Ionicons name="checkbox-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.checklistText}>{doneCount}/{task.checklist.length} checklist items done</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    borderColor: `${colors.primary}30`,
    padding: spacing.md,
    marginBottom: 10,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  subject: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  metaRow: { flexDirection: 'row', gap: 6 },
  metaLabel: { fontSize: 12, fontWeight: '700', color: colors.text, minWidth: 44 },
  metaColon: { fontSize: 12, color: colors.text },
  metaValue: { fontSize: 12, color: colors.textSecondary, flex: 1 },
  checklistRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  checklistText: { fontSize: 11.5, color: colors.textSecondary },
});
