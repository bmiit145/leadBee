import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { colors, spacing, borderRadius } from '../../src/theme';
import { leadService } from '../../src/services/lead.service';
import { taskService } from '../../src/services/task.service';
import { useAuth } from '../../src/stores/auth.store';
import { Lead, TaskStatus, TaskLabel, TaskComment } from '../../src/types';
import { TASK_STATUS_META, TASK_STATUS_ORDER } from '../../src/config/taskMeeting';
import { LeadSummaryCard } from '../../src/components/LeadSummaryCard';
import {
  ScreenHeader,
  SectionBox,
  PrimaryButton,
  StickyFooter,
  STICKY_FOOTER_SPACE,
  RemovableChip,
  ChipRow,
  CenterDialog,
} from '../../src/components/ui';
import {
  TextField,
  DateRangeField,
  SelectField,
  MembersField,
  CommentsField,
} from '../../src/components/fields';

const STATUS_OPTIONS = TASK_STATUS_ORDER.map((s) => ({ value: s, label: TASK_STATUS_META[s].label }));
const LABEL_COLORS = ['#2F7FD0', '#7B61C9', '#C2731F', '#2C7A57', '#BC5430', '#C25E9B'];

interface ChecklistDraft {
  /** Present for items that already exist, so their ticks survive an edit. */
  _id?: string;
  text: string;
  done: boolean;
}

const idOf = (value: unknown) =>
  value && typeof value === 'object' && '_id' in value ? String((value as { _id: string })._id) : String(value);

/**
 * Create a task — or, with `?edit=<id>`, edit one. Editing is for the task's
 * creator or an organizer; the API refuses anyone else.
 */
export default function CreateTaskScreen() {
  const { leadId, edit } = useLocalSearchParams<{ leadId?: string; edit?: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();

  const existing = useQuery({
    queryKey: ['task', edit ?? ''],
    queryFn: () => taskService.getById(edit!),
    enabled: !!edit,
  });

  const { data: fetchedLead } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: () => leadService.getById(leadId!),
    enabled: !!leadId && !edit,
  });
  const lead: Lead | undefined =
    fetchedLead ??
    (existing.data?.leadId && typeof existing.data.leadId === 'object' ? existing.data.leadId : undefined);

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [dateRange, setDateRange] = useState<{ start: Date | null; end: Date | null }>({ start: null, end: null });
  const [status, setStatus] = useState<TaskStatus>('pending');
  const [members, setMembers] = useState<string[]>([]);
  const [checklist, setChecklist] = useState<ChecklistDraft[]>([]);
  const [checklistDialogOpen, setChecklistDialogOpen] = useState(false);
  const [checklistDraft, setChecklistDraft] = useState('');
  const [labels, setLabels] = useState<TaskLabel[]>([]);
  const [labelDraft, setLabelDraft] = useState('');
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Editing fills the same form from the saved task, once.
  useEffect(() => {
    const task = existing.data;
    if (!task || loadedFor === task._id) return;
    setSubject(task.subject);
    setDescription(task.description ?? '');
    setDateRange({ start: new Date(task.startDate), end: new Date(task.endDate) });
    setStatus(task.status);
    setMembers(task.assignedTo.map(idOf));
    setChecklist(task.checklist.map((item) => ({ _id: item._id, text: item.text, done: item.done })));
    setLabels(task.labels);
    setLoadedFor(task._id);
  }, [existing.data, loadedFor]);

  const endsBeforeStart =
    !!dateRange.start && !!dateRange.end && dateRange.end.getTime() < dateRange.start.getTime();
  const canSave = !!(subject.trim() && dateRange.start && dateRange.end) && !endsBeforeStart && (!edit || !!loadedFor);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const fields = {
        subject: subject.trim(),
        description: description.trim(),
        startDate: dateRange.start!.toISOString(),
        endDate: dateRange.end!.toISOString(),
        status,
        assignedTo: members,
        checklist,
        labels,
      };
      if (edit) return taskService.update(edit, fields);
      return taskService.create({
        ...fields,
        description: fields.description || undefined,
        leadId: leadId || undefined,
        comments: comments.map((comment) => ({ text: comment.text })),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['reminder-tasks'] });
      qc.invalidateQueries({ queryKey: ['home-reminder-tasks'] });
      if (edit) qc.invalidateQueries({ queryKey: ['task', edit] });
      router.back();
    },
    onError: (err: any) =>
      Alert.alert(
        'Error',
        err?.response?.data?.error?.message || (edit ? 'Failed to save the task.' : 'Failed to create task.')
      ),
  });

  const addChecklistItem = () => {
    if (!checklistDraft.trim()) return;
    setChecklist((prev) => [...prev, { text: checklistDraft.trim(), done: false }]);
    setChecklistDraft('');
  };

  const addLabel = () => {
    if (!labelDraft.trim()) return;
    setLabels((prev) => [
      ...prev,
      { name: labelDraft.trim(), color: LABEL_COLORS[prev.length % LABEL_COLORS.length] },
    ]);
    setLabelDraft('');
  };

  const addComment = (text: string) =>
    setComments((prev) => [
      ...prev,
      {
        _id: `local-${Date.now()}`,
        userId: user?._id ?? '',
        userName: user?.name ?? 'Me',
        text,
        createdAt: new Date().toISOString(),
      },
    ]);

  if (edit && existing.isLoading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Edit Task" />
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title={edit ? 'Edit Task' : 'Create New Task'} />

      <ScrollView
        contentContainerStyle={{ padding: spacing.md, paddingBottom: STICKY_FOOTER_SPACE }}
        keyboardShouldPersistTaps="handled"
      >
        {lead ? <LeadSummaryCard lead={lead} /> : null}

        <TextField label="Subject" required value={subject} onChangeText={setSubject} placeholder="Enter task subject" />
        <TextField
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="Enter description"
          multiline
        />

        <DateRangeField label="Select date range" required value={dateRange} onChange={setDateRange} />
        {endsBeforeStart ? (
          <Text style={styles.errorText}>The end date cannot be before the start date.</Text>
        ) : null}

        <SelectField
          label="Status"
          required
          placeholder="Select Status"
          dotColor={TASK_STATUS_META[status].color}
          options={STATUS_OPTIONS}
          value={status}
          onChange={setStatus}
        />

        <MembersField value={members} onChange={setMembers} label="Select Members" />

        <SectionBox label={edit ? 'Checklist' : 'Add Checklist'}>
          <TouchableOpacity style={styles.checklistBtn} onPress={() => setChecklistDialogOpen(true)}>
            <Ionicons name="checkbox" size={18} color="#FFFFFF" />
            <Text style={styles.checklistBtnText}>Add Checklist</Text>
            <Ionicons name="add" size={18} color="#FFFFFF" />
          </TouchableOpacity>
          {checklist.map((item, i) => (
            <View key={item._id ?? `new-${i}`} style={styles.checklistItem}>
              <Ionicons
                name={item.done ? 'checkmark-circle' : 'checkmark-circle-outline'}
                size={16}
                color={item.done ? colors.primary : colors.textSecondary}
              />
              <Text style={[styles.checklistItemText, item.done && styles.checklistItemDone]}>{item.text}</Text>
              <TouchableOpacity
                onPress={() => setChecklist((prev) => prev.filter((_, idx) => idx !== i))}
                accessibilityLabel="Remove checklist item"
              >
                <Ionicons name="close" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          ))}
        </SectionBox>

        <SectionBox label="Add Label">
          <View style={styles.inlineInput}>
            <Ionicons name="pricetag" size={18} color={colors.primary} />
            <TextInput
              value={labelDraft}
              onChangeText={setLabelDraft}
              placeholder="Add Label"
              placeholderTextColor={colors.textDisabled}
              style={styles.inlineInputText}
              onSubmitEditing={addLabel}
            />
            <TouchableOpacity onPress={addLabel} accessibilityLabel="Add label">
              <Ionicons name="add" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>
          {labels.length > 0 && (
            <ChipRow>
              {labels.map((l, i) => (
                <RemovableChip
                  key={i}
                  label={l.name}
                  color={l.color}
                  variant="tint"
                  onRemove={() => setLabels((prev) => prev.filter((_, idx) => idx !== i))}
                />
              ))}
            </ChipRow>
          )}
        </SectionBox>

        <SectionBox label="Add Images">
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {(['Gallery', 'Camera'] as const).map((kind) => (
              <TouchableOpacity
                key={kind}
                style={styles.imageBtn}
                onPress={() => Alert.alert('Not available yet', 'Image upload isn’t wired up in this build.')}
              >
                <Ionicons name={kind === 'Gallery' ? 'images-outline' : 'camera-outline'} size={16} color={colors.primary} />
                <Text style={styles.imageBtnText}>{kind}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </SectionBox>

        {/* Comments on an existing task are posted from its detail screen. */}
        {edit ? null : <CommentsField comments={comments} onSubmit={addComment} />}
      </ScrollView>

      <StickyFooter>
        <PrimaryButton
          label={edit ? 'Save Task' : 'Create Task'}
          onPress={() => saveMutation.mutate()}
          disabled={!canSave}
          loading={saveMutation.isPending}
        />
      </StickyFooter>

      <CenterDialog
        visible={checklistDialogOpen}
        onDismiss={() => setChecklistDialogOpen(false)}
        title="Add Checklist"
      >
        <View style={styles.inlineInput}>
          <Ionicons name="checkbox-outline" size={18} color={colors.primary} />
          <TextInput
            value={checklistDraft}
            onChangeText={setChecklistDraft}
            placeholder="Add checklist item..."
            placeholderTextColor={colors.textDisabled}
            style={styles.inlineInputText}
            onSubmitEditing={addChecklistItem}
            autoFocus
          />
        </View>
        <PrimaryButton label="Add" onPress={addChecklistItem} />
      </CenterDialog>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  errorText: { color: colors.error, fontSize: 12, marginTop: -spacing.xs, marginBottom: spacing.sm },
  checklistBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  checklistBtnText: { flex: 1, color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  checklistItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  checklistItemText: { flex: 1, fontSize: 13.5, color: colors.text },
  checklistItemDone: { textDecorationLine: 'line-through', color: colors.textDisabled },
  inlineInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    backgroundColor: colors.surface,
  },
  inlineInputText: { flex: 1, fontSize: 15, color: colors.text, padding: 0 },
  imageBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingVertical: 12,
  },
  imageBtnText: { color: colors.primary, fontWeight: '700', fontSize: 13.5 },
});
