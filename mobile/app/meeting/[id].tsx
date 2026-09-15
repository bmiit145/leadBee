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
  TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { colors, spacing, borderRadius } from '../../src/theme';
import { meetingService } from '../../src/services/meeting.service';
import { queryKeys } from '../../src/lib/queryKeys';
import { useAuth } from '../../src/stores/auth.store';
import { MeetingStatus, User } from '../../src/types';
import {
  MEETING_TYPE_META,
  OPEN_MEETING_STATUSES,
  TASK_STATUS_META,
  formatDuration,
  meetingDisplayStatus,
} from '../../src/config/taskMeeting';
import {
  ScreenHeader,
  SegmentedTabs,
  CenterDialog,
  CommentComposer,
  initialsOf,
} from '../../src/components/ui';
import type { HeaderAction } from '../../src/components/ui';
import { apiErrorMessage, apiStatus, formatBudget, sourceLabel, toDialable } from '../../src/utils/workFormat';

const PRIORITY_COLOR: Record<string, string> = { hot: '#DC2626', warm: '#D97706', cold: '#2F7FD0' };

const idOf = (value: unknown) =>
  value && typeof value === 'object' && '_id' in value ? String((value as { _id: string })._id) : String(value);

const timeLabel = (d: Date) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

type DetailTab = 'status' | 'timeline';

export default function MeetingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { user, isOrganizer } = useAuth();
  const [tab, setTab] = useState<DetailTab>('status');
  const [completeOpen, setCompleteOpen] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [copied, setCopied] = useState(false);

  const { data: meeting, isLoading, error, isRefetching } = useQuery({
    queryKey: queryKeys.meetings.detail(id),
    queryFn: () => meetingService.getById(id),
    enabled: !!id,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: queryKeys.meetings.detail(id) });
    qc.invalidateQueries({ queryKey: queryKeys.meetings.all });
    // The companion task follows every status change; completing touches the lead.
    qc.invalidateQueries({ queryKey: queryKeys.tasks.all });
    qc.invalidateQueries({ queryKey: queryKeys.leads.all });
  };

  const statusMutation = useMutation({
    mutationFn: (input: { status: MeetingStatus; outcome?: string }) =>
      meetingService.setStatus(id, input.status, input.outcome),
    onSuccess: () => {
      setCompleteOpen(false);
      setOutcome('');
      refresh();
    },
    onError: (err) => Alert.alert(t('work.errorTitle'), apiErrorMessage(err, t('work.meeting.updateFailed'))),
  });

  const commentMutation = useMutation({
    mutationFn: (text: string) => meetingService.addComment(id, text),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.meetings.detail(id) }),
    onError: (err) => Alert.alert(t('work.errorTitle'), apiErrorMessage(err, t('work.commentFailed'))),
  });

  const deleteMutation = useMutation({
    mutationFn: () => meetingService.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.meetings.all });
      qc.invalidateQueries({ queryKey: queryKeys.tasks.all });
      router.back();
    },
    onError: (err) => Alert.alert(t('work.errorTitle'), apiErrorMessage(err, t('work.meeting.deleteFailed'))),
  });

  const isOpen = !!meeting && OPEN_MEETING_STATUSES.includes(meeting.status);
  // Deleting is the booker's or an organizer's; the API enforces the same.
  const canDelete = !!meeting && (isOrganizer || idOf(meeting.createdBy) === user?._id);

  const actions = useMemo<HeaderAction[]>(() => {
    const list: HeaderAction[] = [];
    if (isOpen) {
      list.push({
        icon: 'create-outline',
        accessibilityLabel: t('work.meeting.edit'),
        onPress: () => router.push(`/meeting/create?edit=${id}`),
      });
    }
    if (canDelete) {
      list.push({
        icon: 'trash-outline',
        accessibilityLabel: t('work.meeting.delete'),
        onPress: () =>
          Alert.alert(t('work.meeting.delete'), t('work.meeting.deleteConfirm'), [
            { text: t('work.cancel'), style: 'cancel' },
            { text: t('work.delete'), style: 'destructive', onPress: () => deleteMutation.mutate() },
          ]),
      });
    }
    return list;
  }, [isOpen, canDelete, id, router, deleteMutation, t]);

  if (error) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title={t('work.meeting.title')} />
        <View style={styles.center}>
          <Text style={styles.errorText}>
            {apiStatus(error) === 403 ? t('work.meeting.noAccess') : t('work.meeting.notFound')}
          </Text>
        </View>
      </View>
    );
  }

  if (isLoading || !meeting) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const lead = typeof meeting.leadId === 'object' ? meeting.leadId : null;
  const start = new Date(meeting.scheduledAt);
  const end = new Date(start.getTime() + meeting.durationMinutes * 60_000);
  const display = meetingDisplayStatus(meeting);
  const typeMeta = MEETING_TYPE_META[meeting.meetingType];
  const attendees = meeting.assignedTo.filter((m): m is User => typeof m === 'object');
  const bookedBy = typeof meeting.createdBy === 'object' ? meeting.createdBy : null;
  const purposeName =
    (typeof meeting.purpose === 'object' ? meeting.purpose?.name : undefined) || lead?.interestedIn;
  const deal = lead ? formatBudget(lead.budgetMin, lead.budgetMax) : null;
  const linkedTask = meeting.linkedTaskId && typeof meeting.linkedTaskId === 'object' ? meeting.linkedTaskId : null;
  const phone = lead?.contactPhone;

  const openUrl = async (url: string, unavailable: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(unavailable);
    }
  };

  const copyPhone = async () => {
    if (!phone) return;
    await Clipboard.setStringAsync(phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const confirmCancel = () =>
    Alert.alert(t('work.meeting.cancelTitle'), t('work.meeting.cancelConfirm'), [
      { text: t('work.no'), style: 'cancel' },
      {
        text: t('work.meeting.cancelYes'),
        style: 'destructive',
        onPress: () => statusMutation.mutate({ status: 'cancelled' }),
      },
    ]);

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t('work.meeting.title')} actions={actions} />

      <ScrollView
        contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + 32, gap: spacing.md }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Who, and the facts about the deal that decide how to run the meeting. */}
        <View style={styles.hero}>
          <TouchableOpacity
            style={styles.heroTop}
            onPress={() => lead && router.push(`/lead/${lead._id}`)}
            disabled={!lead}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('work.meeting.openLead')}
          >
            <View style={styles.heroAvatar}>
              <Text style={styles.heroInitials}>{initialsOf(lead?.contactName ?? '?')}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroName} numberOfLines={1}>
                {lead?.contactName ?? t('work.unknownContact')}
              </Text>
              <Text style={styles.heroSub}>{meeting.meetingNumber}</Text>
            </View>
            {lead ? <Ionicons name="chevron-forward" size={18} color="#FFFFFFAA" /> : null}
          </TouchableOpacity>

          {phone ? (
            <View style={styles.phoneRow}>
              <Ionicons name="call-outline" size={14} color="#FFFFFFCC" />
              <Text style={styles.heroPhone}>{phone}</Text>
              <TouchableOpacity
                onPress={copyPhone}
                style={styles.copyBtn}
                accessibilityRole="button"
                accessibilityLabel={t('work.meeting.copyPhone')}
              >
                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={13} color={colors.primary} />
              </TouchableOpacity>
              {copied ? <Text style={styles.copied}>{t('work.meeting.copied')}</Text> : null}
            </View>
          ) : null}

          <View style={styles.heroChips}>
            <HeroChip icon={typeMeta.icon} label={t(`work.meetingType.${meeting.meetingType}`)} />
            <HeroChip label={t(`work.meetingStatus.${display.key}`)} color={display.color} />
            {deal ? <HeroChip icon="cash-outline" label={deal} /> : null}
            {lead?.priority ? (
              <HeroChip
                icon="flame-outline"
                label={t(`work.priority.${lead.priority}`)}
                color={PRIORITY_COLOR[lead.priority]}
              />
            ) : null}
          </View>
        </View>

        <View style={styles.card}>
          {lead ? <InfoRow label={t('work.meeting.clientId')} value={lead.leadNumber} /> : null}
          <InfoRow
            label={t('work.meeting.date')}
            value={start.toLocaleDateString('en-GB', {
              weekday: 'short',
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
          />
          <InfoRow label={t('work.meeting.purpose')} value={purposeName || '—'} />
          {lead ? (
            <InfoRow label={t('work.meeting.source')} value={lead.sourceDetail || sourceLabel(lead.source)} />
          ) : null}
          <InfoRow
            label={t('work.meeting.attendees')}
            value={attendees.length ? attendees.map((a) => a.name).join(', ') : '—'}
          />
          {bookedBy ? <InfoRow label={t('work.meeting.bookedBy')} value={bookedBy.name} /> : null}

          <View style={styles.timeRow}>
            <View style={styles.timePill}>
              <Text style={styles.timeCaption}>{t('work.startTime')}</Text>
              <Text style={styles.timeValue}>{timeLabel(start)}</Text>
            </View>
            <View style={styles.timeTrack}>
              <Text style={styles.duration}>{formatDuration(meeting.durationMinutes)}</Text>
              <View style={styles.dash} />
            </View>
            <View style={[styles.timePill, { alignItems: 'flex-end' }]}>
              <Text style={styles.timeCaption}>{t('work.endTime')}</Text>
              <Text style={styles.timeValue}>{timeLabel(end)}</Text>
            </View>
          </View>

          {phone ? (
            <View style={styles.contactRow}>
              <TouchableOpacity
                style={[styles.contactBtn, styles.whatsapp]}
                onPress={() =>
                  openUrl(`whatsapp://send?phone=${toDialable(phone)}`, t('work.meeting.whatsappUnavailable'))
                }
                accessibilityRole="button"
              >
                <Ionicons name="logo-whatsapp" size={18} color="#FFFFFF" />
                <Text style={styles.contactText}>{t('work.meeting.whatsapp')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.contactBtn, styles.call]}
                onPress={() => openUrl(`tel:${toDialable(phone)}`, t('work.meeting.callUnavailable'))}
                accessibilityRole="button"
              >
                <Ionicons name="call" size={17} color="#FFFFFF" />
                <Text style={styles.contactText}>{t('work.meeting.call')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        <SegmentedTabs<DetailTab>
          tabs={[
            { value: 'status', label: t('work.meeting.statusTab') },
            { value: 'timeline', label: t('work.meeting.timelineTab'), count: meeting.comments?.length ?? 0 },
          ]}
          value={tab}
          onChange={setTab}
          padCounts={false}
        />

        {tab === 'status' ? (
          <View style={styles.card}>
            {isOpen ? (
              <>
                {display.key === 'missed' ? (
                  <View style={styles.missedBanner}>
                    <Ionicons name="alert-circle" size={18} color={display.color} />
                    <Text style={[styles.missedText, { color: display.color }]}>{t('work.meeting.missedHint')}</Text>
                  </View>
                ) : (
                  <StateBlock
                    icon="time-outline"
                    color={display.color}
                    title={t(`work.meeting.state.${display.key}.title`)}
                    message={t(`work.meeting.state.${display.key}.message`, { when: timeLabel(start) })}
                  />
                )}
                <ActionButton
                  icon="checkmark-circle-outline"
                  label={t('work.meeting.complete')}
                  color="#2C7A57"
                  filled
                  disabled={statusMutation.isPending}
                  onPress={() => setCompleteOpen(true)}
                />
                <ActionButton
                  icon="calendar-outline"
                  label={t('work.meeting.reschedule')}
                  color={colors.primary}
                  disabled={statusMutation.isPending}
                  onPress={() => router.push(`/meeting/create?edit=${id}`)}
                />
                <ActionButton
                  icon="close-circle-outline"
                  label={t('work.meeting.cancelMeeting')}
                  color="#BC5430"
                  disabled={statusMutation.isPending}
                  onPress={confirmCancel}
                />
              </>
            ) : (
              <>
                <StateBlock
                  icon={meeting.status === 'completed' ? 'checkmark-circle' : 'close-circle'}
                  color={display.color}
                  title={t(`work.meeting.state.${meeting.status}.title`)}
                  message={t(`work.meeting.state.${meeting.status}.message`)}
                />
                {meeting.outcome ? (
                  <View style={styles.outcome}>
                    <Text style={styles.outcomeLabel}>{t('work.meeting.outcome')}</Text>
                    <Text style={styles.outcomeText}>{meeting.outcome}</Text>
                  </View>
                ) : null}
                <ActionButton
                  icon="refresh"
                  label={t('work.meeting.reopen')}
                  color={colors.primary}
                  disabled={statusMutation.isPending}
                  onPress={() => statusMutation.mutate({ status: 'scheduled' })}
                />
              </>
            )}

            {linkedTask ? (
              <TouchableOpacity
                style={styles.taskLink}
                onPress={() => router.push(`/task/${linkedTask._id}`)}
                accessibilityRole="button"
              >
                <Ionicons name="clipboard-outline" size={18} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.taskLinkCaption}>{t('work.meeting.followUpTask')}</Text>
                  <Text style={styles.taskLinkTitle} numberOfLines={1}>
                    {linkedTask.taskNumber} · {linkedTask.subject}
                  </Text>
                </View>
                <View
                  style={[
                    styles.taskStatusDot,
                    { backgroundColor: TASK_STATUS_META[linkedTask.status]?.color ?? colors.border },
                  ]}
                />
                <Text style={styles.taskLinkStatus}>{t(`work.taskStatus.${linkedTask.status}`)}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : null}
            {isRefetching ? <ActivityIndicator color={colors.primary} /> : null}
          </View>
        ) : (
          <View style={styles.card}>
            {meeting.notes ? (
              <View style={styles.outcome}>
                <Text style={styles.outcomeLabel}>{t('work.meeting.notes')}</Text>
                <Text style={styles.outcomeText}>{meeting.notes}</Text>
              </View>
            ) : null}
            {(meeting.comments ?? []).length === 0 ? (
              <Text style={styles.emptyTimeline}>{t('work.meeting.noComments')}</Text>
            ) : null}
            <CommentComposer
              comments={meeting.comments ?? []}
              onSubmit={(text) => commentMutation.mutate(text)}
              submitting={commentMutation.isPending}
              placeholder={t('work.commentPlaceholder')}
            />
          </View>
        )}

      </ScrollView>

      <CenterDialog
        visible={completeOpen}
        onDismiss={() => setCompleteOpen(false)}
        title={t('work.meeting.completeTitle')}
      >
        <Text style={styles.dialogText}>{t('work.meeting.completeConfirm')}</Text>
        <TextInput
          value={outcome}
          onChangeText={setOutcome}
          placeholder={t('work.meeting.outcomePlaceholder')}
          placeholderTextColor={colors.textDisabled}
          style={styles.outcomeInput}
          multiline
          maxLength={2000}
        />
        <View style={styles.dialogButtons}>
          <TouchableOpacity style={[styles.dialogBtn, styles.dialogSecondary]} onPress={() => setCompleteOpen(false)}>
            <Text style={styles.dialogSecondaryText}>{t('work.no')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.dialogBtn, styles.dialogPrimary]}
            disabled={statusMutation.isPending}
            onPress={() => statusMutation.mutate({ status: 'completed', outcome: outcome.trim() || undefined })}
          >
            {statusMutation.isPending ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.dialogPrimaryText}>{t('work.meeting.completeYes')}</Text>
            )}
          </TouchableOpacity>
        </View>
      </CenterDialog>
    </View>
  );
}

function HeroChip({ label, icon, color }: { label: string; icon?: string; color?: string }) {
  return (
    <View style={[styles.heroChip, color ? { backgroundColor: color, borderColor: color } : null]}>
      {icon ? <Ionicons name={icon as never} size={13} color="#FFFFFF" /> : null}
      <Text style={styles.heroChipText}>{label}</Text>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function StateBlock({ icon, color, title, message }: { icon: string; color: string; title: string; message: string }) {
  return (
    <View style={styles.state}>
      <View style={[styles.stateIcon, { backgroundColor: `${color}1A` }]}>
        <Ionicons name={icon as never} size={30} color={color} />
      </View>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateMessage}>{message}</Text>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  color,
  filled,
  disabled,
  onPress,
}: {
  icon: string;
  label: string;
  color: string;
  filled?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.actionBtn,
        { borderColor: color },
        filled && { backgroundColor: color },
        disabled && { opacity: 0.5 },
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
    >
      <Ionicons name={icon as never} size={18} color={filled ? '#FFFFFF' : color} />
      <Text style={[styles.actionText, { color: filled ? '#FFFFFF' : color }]}>{label.toUpperCase()}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  errorText: { fontSize: 15, color: colors.textSecondary },
  hero: { backgroundColor: colors.primary, borderRadius: borderRadius.xl, padding: spacing.md, gap: 10 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroInitials: { fontSize: 17, fontWeight: '800', color: colors.primary },
  heroName: { fontSize: 18, fontWeight: '800', color: '#FFFFFF' },
  heroSub: { fontSize: 12, color: '#FFFFFFAA', marginTop: 1 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroPhone: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  copyBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copied: { fontSize: 12, color: '#FFFFFFCC' },
  heroChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  heroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: '#FFFFFF40',
    backgroundColor: '#FFFFFF1A',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  heroChipText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 10,
  },
  infoRow: { flexDirection: 'row', gap: 10 },
  infoLabel: { width: 110, fontSize: 12, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.3 },
  infoValue: { flex: 1, fontSize: 13.5, fontWeight: '600', color: colors.text },
  timeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  timePill: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  timeCaption: { fontSize: 10.5, color: colors.textSecondary },
  timeValue: { fontSize: 15, fontWeight: '800', color: colors.text },
  timeTrack: { flex: 1, alignItems: 'center', paddingHorizontal: 6 },
  duration: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, marginBottom: 4 },
  dash: { width: '100%', height: 0, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border },
  contactRow: { flexDirection: 'row', gap: spacing.sm, marginTop: 4 },
  contactBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: borderRadius.full,
    paddingVertical: 11,
  },
  whatsapp: { backgroundColor: '#1E8E5A' },
  call: { backgroundColor: colors.primary },
  contactText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  state: { alignItems: 'center', gap: 6, paddingVertical: spacing.sm },
  stateIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  stateTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  stateMessage: { fontSize: 13, color: colors.textSecondary, textAlign: 'center' },
  missedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#C2731F14',
    borderRadius: borderRadius.lg,
    padding: spacing.sm,
  },
  missedText: { flex: 1, fontSize: 13, fontWeight: '600' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderRadius: borderRadius.full,
    paddingVertical: 12,
  },
  actionText: { fontSize: 13.5, fontWeight: '800', letterSpacing: 0.4 },
  outcome: { backgroundColor: colors.background, borderRadius: borderRadius.lg, padding: spacing.sm, gap: 2 },
  outcomeLabel: { fontSize: 11.5, fontWeight: '700', color: colors.textSecondary },
  outcomeText: { fontSize: 13.5, color: colors.text },
  taskLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    marginTop: 4,
  },
  taskLinkCaption: { fontSize: 11, color: colors.textSecondary },
  taskLinkTitle: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  taskStatusDot: { width: 7, height: 7, borderRadius: 3.5 },
  taskLinkStatus: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  emptyTimeline: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', paddingVertical: 4 },
  dialogText: { fontSize: 14, color: colors.textSecondary, marginBottom: spacing.sm },
  outcomeInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.sm,
    minHeight: 80,
    fontSize: 14,
    color: colors.text,
    textAlignVertical: 'top',
  },
  dialogButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  dialogBtn: { flex: 1, borderRadius: borderRadius.full, paddingVertical: 12, alignItems: 'center' },
  dialogSecondary: { borderWidth: 1.5, borderColor: colors.primary },
  dialogSecondaryText: { fontSize: 14.5, fontWeight: '700', color: colors.primary },
  dialogPrimary: { backgroundColor: '#2C7A57' },
  dialogPrimaryText: { fontSize: 14.5, fontWeight: '700', color: '#FFFFFF' },
});
