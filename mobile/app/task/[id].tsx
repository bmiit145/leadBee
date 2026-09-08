import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { colors, spacing, borderRadius } from '../../src/theme';
import { taskService } from '../../src/services/task.service';
import { TaskStatus } from '../../src/types';
import { TASK_STATUS_META } from '../../src/config/taskMeeting';
import { ScreenHeader, StatusChip, SelectListDialog } from '../../src/components/ui';
import { CommentsField } from '../../src/components/fields';

const STATUS_OPTIONS = Object.entries(TASK_STATUS_META).map(([value, meta]) => ({ value: value as TaskStatus, label: meta.label }));

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);

  const { data: task, isLoading } = useQuery({
    queryKey: ['task', id],
    queryFn: () => taskService.getById(id),
    enabled: !!id,
  });

  const statusMutation = useMutation({
    mutationFn: (status: TaskStatus) => taskService.setStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task', id] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err: any) => Alert.alert('Error', err?.response?.data?.message || 'Failed to update task.'),
  });

  const checklistMutation = useMutation({
    mutationFn: (itemId: string) => taskService.toggleChecklistItem(id, itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task', id] }),
  });

  const commentMutation = useMutation({
    mutationFn: (text: string) => taskService.addComment(id, text),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task', id] }),
  });

  if (isLoading || !task) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const statusMeta = TASK_STATUS_META[task.status];

  return (
    <View style={styles.screen}>
      <ScreenHeader title={task.subject} />

      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + 32 }}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.subject}>{task.subject}</Text>
            <TouchableOpacity onPress={() => setStatusPickerOpen(true)}>
              <StatusChip label={statusMeta.label} color={statusMeta.color} filled />
            </TouchableOpacity>
          </View>
          {task.description ? <Text style={styles.description}>{task.description}</Text> : null}

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

          {task.labels.length > 0 && (
            <View style={styles.labelChipsRow}>
              {task.labels.map((l, i) => (
                <View key={i} style={[styles.labelChip, { backgroundColor: `${l.color}20`, borderColor: l.color }]}>
                  <Text style={[styles.labelChipText, { color: l.color }]}>{l.name}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {task.checklist.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Checklist</Text>
            {task.checklist.map((item) => (
              <TouchableOpacity
                key={item._id}
                style={styles.checklistRow}
                onPress={() => checklistMutation.mutate(item._id)}
              >
                <Ionicons
                  name={item.done ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={item.done ? colors.primary : colors.border}
                />
                <Text style={[styles.checklistText, item.done && styles.checklistTextDone]}>{item.text}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <CommentsField
          label="Comments"
          comments={task.comments}
          onSubmit={(text) => commentMutation.mutate(text)}
          submitting={commentMutation.isPending}
        />
      </ScrollView>

      <SelectListDialog
        visible={statusPickerOpen}
        onDismiss={() => setStatusPickerOpen(false)}
        title="Status"
        options={STATUS_OPTIONS}
        value={task.status}
        onSelect={(v) => statusMutation.mutate(v as TaskStatus)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  card: {
    backgroundColor: colors.surface, borderRadius: borderRadius.xl, borderWidth: 1.5,
    borderColor: `${colors.primary}30`, padding: spacing.md, gap: 8,
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  subject: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.text },
  description: { fontSize: 13.5, color: colors.textSecondary },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  metaRow: { flexDirection: 'row', gap: 6 },
  metaLabel: { fontSize: 12, fontWeight: '700', color: colors.text, minWidth: 44 },
  metaColon: { fontSize: 12, color: colors.text },
  metaValue: { fontSize: 12, color: colors.textSecondary, flex: 1 },
  labelChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  labelChip: { borderWidth: 1, borderRadius: borderRadius.full, paddingHorizontal: 10, paddingVertical: 4 },
  labelChipText: { fontSize: 11.5, fontWeight: '700' },
  section: { marginTop: spacing.md },
  sectionTitle: { fontSize: 14.5, fontWeight: '700', color: colors.text, marginBottom: 8 },
  checklistRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  checklistText: { fontSize: 14, color: colors.text, flex: 1 },
  checklistTextDone: { textDecorationLine: 'line-through', color: colors.textDisabled },
});
