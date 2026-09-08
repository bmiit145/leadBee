import React, { useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { colors, spacing, borderRadius } from '../../src/theme';
import { leadService } from '../../src/services/lead.service';
import { taskService } from '../../src/services/task.service';
import { useAuth } from '../../src/stores/auth.store';
import { TaskStatus, TaskLabel, TaskComment } from '../../src/types';
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

export default function CreateTaskScreen() {
  const { leadId } = useLocalSearchParams<{ leadId?: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();

  const { data: lead } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: () => leadService.getById(leadId!),
    enabled: !!leadId,
  });

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [dateRange, setDateRange] = useState<{ start: Date | null; end: Date | null }>({ start: null, end: null });
  const [status, setStatus] = useState<TaskStatus>('pending');
  const [members, setMembers] = useState<string[]>([]);
  const [checklist, setChecklist] = useState<string[]>([]);
  const [checklistDialogOpen, setChecklistDialogOpen] = useState(false);
  const [checklistDraft, setChecklistDraft] = useState('');
  const [labels, setLabels] = useState<TaskLabel[]>([]);
  const [labelDraft, setLabelDraft] = useState('');
  const [comments, setComments] = useState<TaskComment[]>([]);

  const canCreate = !!(subject.trim() && dateRange.start && dateRange.end);

  const createMutation = useMutation({
    mutationFn: () =>
      taskService.create({
        subject: subject.trim(),
        description: description.trim() || undefined,
        startDate: dateRange.start!.toISOString(),
        endDate: dateRange.end!.toISOString(),
        status,
        assignedTo: members,
        checklist: checklist.map((text) => ({ text, done: false })),
        labels,
        leadId: leadId || undefined,
        comments,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['reminder-tasks'] });
      qc.invalidateQueries({ queryKey: ['home-reminder-tasks'] });
      router.back();
    },
    onError: (err: any) =>
      Alert.alert('Error', err?.response?.data?.message || 'Failed to create task.'),
  });

  const addChecklistItem = () => {
    if (!checklistDraft.trim()) return;
    setChecklist((prev) => [...prev, checklistDraft.trim()]);
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

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Create New Task" />

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

        <SectionBox label="Add Checklist">
          <TouchableOpacity style={styles.checklistBtn} onPress={() => setChecklistDialogOpen(true)}>
            <Ionicons name="checkbox" size={18} color="#FFFFFF" />
            <Text style={styles.checklistBtnText}>Add Checklist</Text>
            <Ionicons name="add" size={18} color="#FFFFFF" />
          </TouchableOpacity>
          {checklist.map((item, i) => (
            <View key={i} style={styles.checklistItem}>
              <Ionicons name="checkmark-circle-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.checklistItemText}>{item}</Text>
              <TouchableOpacity onPress={() => setChecklist((prev) => prev.filter((_, idx) => idx !== i))}>
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

        <CommentsField comments={comments} onSubmit={addComment} />
      </ScrollView>

      <StickyFooter>
        <PrimaryButton
          label="Create Task"
          onPress={() => createMutation.mutate()}
          disabled={!canCreate}
          loading={createMutation.isPending}
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
