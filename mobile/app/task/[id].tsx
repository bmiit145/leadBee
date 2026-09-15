import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { colors, spacing, borderRadius } from '../../src/theme';
import { taskService } from '../../src/services/task.service';
import { queryKeys } from '../../src/lib/queryKeys';
import { useAuth } from '../../src/stores/auth.store';
import { TaskStatus, User } from '../../src/types';
import { TASK_STATUS_META, TASK_STATUS_ORDER } from '../../src/config/taskMeeting';
import {
  ScreenHeader,
  SegmentedTabs,
  SelectListDialog,
  CommentComposer,
  Avatar,
} from '../../src/components/ui';
import type { HeaderAction } from '../../src/components/ui';
import { apiErrorMessage, apiStatus, toDialable } from '../../src/utils/workFormat';

const idOf = (value: unknown) =>
  value && typeof value === 'object' && '_id' in value ? String((value as { _id: string })._id) : String(value);

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

type DetailTab = 'comments' | 'members' | 'checklist';

interface Member {
  user: Pick<User, '_id' | 'name'> & Partial<Pick<User, 'phone' | 'role'>>;
  isCreator: boolean;
  isAssignee: boolean;
}

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { user, isOrganizer } = useAuth();
  const [tab, setTab] = useState<DetailTab>('comments');
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);

  const { data: task, isLoading, error } = useQuery({
    queryKey: queryKeys.tasks.detail(id),
    queryFn: () => taskService.getById(id),
    enabled: !!id,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: queryKeys.tasks.detail(id) });
    qc.invalidateQueries({ queryKey: queryKeys.tasks.all });
  };

  const failed = (fallback: string) => (err: unknown) =>
    Alert.alert(t('work.errorTitle'), apiErrorMessage(err, fallback));

  const statusMutation = useMutation({
    mutationFn: (status: TaskStatus) => taskService.setStatus(id, status),
    onSuccess: refresh,
    onError: failed(t('work.task.updateFailed')),
  });

  const checklistMutation = useMutation({
    mutationFn: (itemId: string) => taskService.toggleChecklistItem(id, itemId),
    onSuccess: refresh,
    onError: failed(t('work.task.updateFailed')),
  });

  const commentMutation = useMutation({
    mutationFn: (text: string) => taskService.addComment(id, text),
    onSuccess: refresh,
    onError: failed(t('work.commentFailed')),
  });

  const deleteMutation = useMutation({
    mutationFn: () => taskService.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tasks.all });
      qc.invalidateQueries({ queryKey: queryKeys.meetings.all });
      router.back();
    },
    onError: failed(t('work.task.deleteFailed')),
  });

  // Editing and deleting are the creator's or an organizer's; the API enforces the same.
  const canManage = !!task && (isOrganizer || idOf(task.createdBy) === user?._id);

  const actions = useMemo<HeaderAction[]>(
    () =>
      canManage
        ? [
            {
              icon: 'create-outline',
              accessibilityLabel: t('work.task.edit'),
              onPress: () => router.push(`/task/create?edit=${id}`),
            },
            {
              icon: 'trash-outline',
              accessibilityLabel: t('work.task.delete'),
              onPress: () =>
                Alert.alert(t('work.task.delete'), t('work.task.deleteConfirm'), [
                  { text: t('work.cancel'), style: 'cancel' },
                  { text: t('work.delete'), style: 'destructive', onPress: () => deleteMutation.mutate() },
                ]),
            },
          ]
        : [],
    [canManage, id, router, deleteMutation, t]
  );

  // The creator first, then everyone assigned — one row per person.
  const members = useMemo<Member[]>(() => {
    if (!task) return [];
    const rows = new Map<string, Member>();
    if (typeof task.createdBy === 'object') {
      rows.set(task.createdBy._id, { user: task.createdBy, isCreator: true, isAssignee: false });
    }
    for (const assignee of task.assignedTo) {
      if (typeof assignee !== 'object') continue;
      const existing = rows.get(assignee._id);
      if (existing) existing.isAssignee = true;
      else rows.set(assignee._id, { user: assignee, isCreator: false, isAssignee: true });
    }
    return [...rows.values()];
  }, [task]);

  if (error) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title={t('work.task.title')} />
        <View style={styles.center}>
          <Text style={styles.errorText}>
            {apiStatus(error) === 403 ? t('work.task.noAccess') : t('work.task.notFound')}
          </Text>
        </View>
      </View>
    );
  }

  if (isLoading || !task) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const statusMeta = TASK_STATUS_META[task.status];
  const lead = task.leadId && typeof task.leadId === 'object' ? task.leadId : null;
  const meeting = task.meetingId && typeof task.meetingId === 'object' ? task.meetingId : null;
  const doneCount = task.checklist.filter((c) => c.done).length;
  const progress = task.checklist.length ? doneCount / task.checklist.length : 0;
  const overdue = task.status !== 'completed' && new Date(task.endDate).getTime() < Date.now();

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t('work.task.title')} actions={actions} />

      <ScrollView
        contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + 32, gap: spacing.md }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={styles.heroIcon}>
              <Ionicons name="clipboard" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>{task.subject}</Text>
              <Text style={styles.heroSub}>{task.taskNumber}</Text>
            </View>
          </View>

          {task.description ? <Text style={styles.heroDescription}>{task.description}</Text> : null}

          <View style={styles.dates}>
            <View style={styles.datePill}>
              <Text style={styles.dateCaption}>{t('work.startDate')}</Text>
              <Text style={styles.dateValue}>{dateLabel(task.startDate)}</Text>
            </View>
            <View style={styles.dash} />
            <View style={styles.datePill}>
              <Text style={styles.dateCaption}>{t('work.endDate')}</Text>
              <Text style={styles.dateValue}>{dateLabel(task.endDate)}</Text>
            </View>
          </View>
          {overdue ? <Text style={styles.overdue}>{t('work.task.overdueHint')}</Text> : null}

          <TouchableOpacity
            style={[styles.statusBar, { backgroundColor: statusMeta.color }]}
            onPress={() => setStatusPickerOpen(true)}
            disabled={statusMutation.isPending}
            accessibilityRole="button"
            accessibilityLabel={t('work.task.changeStatus', { status: t(`work.taskStatus.${task.status}`) })}
          >
            {statusMutation.isPending ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Text style={styles.statusText}>{t(`work.taskStatus.${task.status}`).toUpperCase()}</Text>
                <Ionicons name="chevron-down" size={16} color="#FFFFFF" />
              </>
            )}
          </TouchableOpacity>

          {task.labels.length > 0 ? (
            <View style={styles.labels}>
              {task.labels.map((l, i) => (
                <View key={`${l.name}-${i}`} style={styles.labelChip}>
                  <View style={[styles.labelDot, { backgroundColor: l.color }]} />
                  <Text style={styles.labelText}>{l.name}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {lead || meeting ? (
          <View style={styles.card}>
            {lead ? (
              <LinkRow
                icon="person-outline"
                caption={t('work.task.lead')}
                title={`${lead.leadNumber} · ${lead.contactName}`}
                onPress={() => router.push(`/lead/${lead._id}`)}
              />
            ) : null}
            {meeting ? (
              <LinkRow
                icon="people-outline"
                caption={t('work.task.meeting')}
                title={meeting.meetingNumber ?? t('work.task.meeting')}
                onPress={() => router.push(`/meeting/${meeting._id}`)}
              />
            ) : null}
          </View>
        ) : null}

        <SegmentedTabs<DetailTab>
          tabs={[
            { value: 'comments', label: t('work.task.commentsTab'), count: task.comments.length },
            { value: 'members', label: t('work.task.membersTab'), count: members.length },
            { value: 'checklist', label: t('work.task.checklistTab') },
          ]}
          value={tab}
          onChange={setTab}
          padCounts={false}
        />

        {tab === 'comments' ? (
          <View style={styles.card}>
            {task.comments.length === 0 ? <Text style={styles.empty}>{t('work.task.noComments')}</Text> : null}
            <CommentComposer
              comments={task.comments}
              onSubmit={(text) => commentMutation.mutate(text)}
              submitting={commentMutation.isPending}
              placeholder={t('work.commentPlaceholder')}
            />
          </View>
        ) : null}

        {tab === 'members' ? (
          <View style={[styles.card, { gap: 0 }]}>
            {members.map((member, index) => {
              const isYou = member.user._id === user?._id;
              return (
                <View key={member.user._id} style={[styles.memberRow, index > 0 && styles.memberDivider]}>
                  <Avatar name={member.user.name} size={40} variant="solid" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName} numberOfLines={1}>
                      {member.user.name}
                      {isYou ? ` ${t('work.task.you')}` : ''}
                    </Text>
                    <View style={styles.memberTags}>
                      {member.isCreator ? <Tag label={t('work.task.creator')} strong /> : null}
                      {member.isAssignee ? <Tag label={t('work.task.assignee')} /> : null}
                      {member.user.role ? <Tag label={t(`work.role.${member.user.role}`)} /> : null}
                    </View>
                  </View>
                  {member.user.phone && !isYou ? (
                    <TouchableOpacity
                      style={styles.memberCall}
                      onPress={() =>
                        Linking.openURL(`tel:${toDialable(member.user.phone!)}`).catch(() =>
                          Alert.alert(t('work.meeting.callUnavailable'))
                        )
                      }
                      accessibilityRole="button"
                      accessibilityLabel={t('work.task.callMember', { name: member.user.name })}
                    >
                      <Ionicons name="call" size={16} color={colors.primary} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })}
            {members.length === 0 ? <Text style={styles.empty}>{t('work.task.noMembers')}</Text> : null}
          </View>
        ) : null}

        {tab === 'checklist' ? (
          <View style={styles.card}>
            {task.checklist.length === 0 ? (
              <Text style={styles.empty}>{t('work.task.noChecklist')}</Text>
            ) : (
              <>
                <View style={styles.progressHead}>
                  <Text style={styles.progressText}>
                    {t('work.checklistProgress', { done: doneCount, total: task.checklist.length })}
                  </Text>
                  <Text style={styles.progressPct}>{Math.round(progress * 100)}%</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
                </View>
                {task.checklist.map((item) => (
                  <TouchableOpacity
                    key={item._id}
                    style={styles.checkRow}
                    onPress={() => checklistMutation.mutate(item._id)}
                    disabled={checklistMutation.isPending}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: item.done }}
                  >
                    <Ionicons
                      name={item.done ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={item.done ? '#2C7A57' : colors.textSecondary}
                    />
                    <Text style={[styles.checkText, item.done && styles.checkTextDone]}>{item.text}</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}
          </View>
        ) : null}
      </ScrollView>

      <SelectListDialog
        visible={statusPickerOpen}
        onDismiss={() => setStatusPickerOpen(false)}
        title={t('work.task.status')}
        options={TASK_STATUS_ORDER.map((s) => ({ value: s, label: t(`work.taskStatus.${s}`) }))}
        value={task.status}
        onSelect={(v) => {
          if (v !== task.status) statusMutation.mutate(v as TaskStatus);
        }}
      />
    </View>
  );
}

function LinkRow({
  icon,
  caption,
  title,
  onPress,
}: {
  icon: string;
  caption: string;
  title: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.linkRow} onPress={onPress} accessibilityRole="button">
      <View style={styles.linkIcon}>
        <Ionicons name={icon as never} size={16} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.linkCaption}>{caption}</Text>
        <Text style={styles.linkTitle} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
    </TouchableOpacity>
  );
}

function Tag({ label, strong }: { label: string; strong?: boolean }) {
  return (
    <View style={[styles.tag, strong && styles.tagStrong]}>
      <Text style={[styles.tagText, strong && styles.tagTextStrong]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  errorText: { fontSize: 15, color: colors.textSecondary },
  hero: { backgroundColor: colors.primary, borderRadius: borderRadius.xl, padding: spacing.md, gap: 12 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { fontSize: 18, fontWeight: '800', color: '#FFFFFF' },
  heroSub: { fontSize: 12, color: '#FFFFFFAA', marginTop: 1 },
  heroDescription: { fontSize: 13.5, color: '#FFFFFFDD', lineHeight: 19 },
  dates: { flexDirection: 'row', alignItems: 'center' },
  datePill: {
    backgroundColor: '#FFFFFF1A',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: '#FFFFFF33',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  dateCaption: { fontSize: 10, color: '#FFFFFFAA' },
  dateValue: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  dash: {
    flex: 1,
    height: 0,
    borderTopWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#FFFFFF55',
    marginHorizontal: 6,
  },
  overdue: { fontSize: 12.5, fontWeight: '700', color: '#FCA5A5' },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: borderRadius.full,
    paddingVertical: 10,
    minHeight: 42,
  },
  statusText: { fontSize: 13, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 },
  labels: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  labelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  labelDot: { width: 8, height: 8, borderRadius: 4 },
  labelText: { fontSize: 12, fontWeight: '700', color: colors.text },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 10,
  },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  linkIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkCaption: { fontSize: 11, color: colors.textSecondary },
  linkTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  empty: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', paddingVertical: 6 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  memberDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  memberName: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  memberTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 3 },
  memberCall: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tag: { backgroundColor: colors.background, borderRadius: borderRadius.full, paddingHorizontal: 8, paddingVertical: 2 },
  tagStrong: { backgroundColor: colors.primary },
  tagText: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  tagTextStrong: { color: '#FFFFFF' },
  progressHead: { flexDirection: 'row', justifyContent: 'space-between' },
  progressText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  progressPct: { fontSize: 13, fontWeight: '800', color: colors.text },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.background, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: '#2C7A57' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  checkText: { fontSize: 14, color: colors.text, flex: 1 },
  checkTextDone: { textDecorationLine: 'line-through', color: colors.textSecondary },
});
