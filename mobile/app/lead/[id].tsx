import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leadService } from '../../src/services/lead.service';
import { SetReminderDialog } from '../../src/components/SetReminderDialog';
import { LeadDetailHeader } from '../../src/components/LeadDetailHeader';
import { LeadThreadPanel } from '../../src/components/LeadThreadPanel';
import { LeadCallsPanel } from '../../src/components/LeadCallsPanel';
import { QuickReplyPanel } from '../../src/components/QuickReplyPanel';
import { LeadDocumentsPanel } from '../../src/components/LeadDocumentsPanel';
import { LeadClientDetailsPanel } from '../../src/components/LeadClientDetailsPanel';
import { LeadWorkPanel } from '../../src/components/LeadWorkPanel';
import { TransferLeadSheet } from '../../src/components/transfers/TransferLeadSheet';
import { PendingTransferBanner } from '../../src/components/transfers/PendingTransferBanner';
import {
  ScreenHeader,
  UnderlineTabs,
  StatusChip,
  CenterDialog,
  AnimatedChevrons,
  initialsOf,
} from '../../src/components/ui';
import type { HeaderAction, UnderlineTab } from '../../src/components/ui';
import { useAuth } from '../../src/stores/auth.store';
import { LeadStage } from '../../src/types';
import { colors, spacing, borderRadius } from '../../src/theme';
import { LEAD_STAGE_META } from '../../src/config/leadStages';
import { queryKeys } from '../../src/lib/queryKeys';
import { useTranslation } from 'react-i18next';
import { dropReasonService } from '../../src/services/dropReason.service';

// Progress rail: the happy path only. Side states (drop, postponed, call_again,
// pipeline) are reachable from the picker but are not steps on the way to a sale.
const STAGE_ORDER: LeadStage[] = [
  'new', 'assign_lead', 'follow_up', 'qualified', 'in_progress', 'interested', 'meeting',
  'proposal_sent', 'order_received',
];

/**
 * The drop tag and the agent's note share `lostReason`, which is text capped at
 * 200 by the API. A tag name is at most 80, so the note is held to leave room
 * for both and the separator.
 */
const DROP_NOTE_MAX = 110;

function composeLostReason(tag: string | null, note: string): string | undefined {
  const trimmed = note.trim();
  if (tag && trimmed) return `${tag} — ${trimmed}`;
  return tag ?? (trimmed || undefined);
}

const TABS: UnderlineTab[] = [
  { key: 'timeline', label: 'Time Line' },
  { key: 'work', label: 'Meetings & Tasks' },
  { key: 'quick_reply', label: 'Quick Reply' },
  { key: 'document', label: 'Document' },
  { key: 'attachment', label: 'Attachment' },
  { key: 'details', label: 'Client Details' },
  { key: 'ask_query', label: 'Ask Query' },
  { key: 'notes', label: 'Notes' },
  { key: 'calls', label: 'Calls' },
];

const THREAD_TABS = new Set(['timeline', 'ask_query', 'notes']);

/** How far the details handle rises above the tab panel — half its height. */
const HANDLE_OVERLAP = 14;

// Older Android builds animate layout changes only when asked; newer ones ignore this.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function LeadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, isOrganizer, hasPermission } = useAuth();
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [tab, setTab] = useState('timeline');

  // The lead summary folds away so the Time Line and the other tabs get the
  // screen — a long conversation should not scroll inside a sliver. Collapsed,
  // the customer stays named at the top, so it is always clear whose lead this is.
  const [detailsOpen, setDetailsOpen] = useState(true);
  const toggleDetails = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setDetailsOpen((open) => !open);
  };
  const [reminderStage, setReminderStage] = useState<LeadStage | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [dropReasonOpen, setDropReasonOpen] = useState(false);
  const [dropReason, setDropReason] = useState('');
  const [dropTag, setDropTag] = useState<string | null>(null);

  const dropReasons = useQuery({
    queryKey: queryKeys.lookups.dropReasons,
    queryFn: () => dropReasonService.list(),
    enabled: dropReasonOpen,
    staleTime: 5 * 60_000,
  });

  // Anyone who may edit leads edits the ones they can open — not only admins.
  const canEditLead = hasPermission('leads.edit');

  const { data: lead, isLoading } = useQuery({
    queryKey: queryKeys.leads.detail(id),
    queryFn: () => leadService.getById(id),
    enabled: !!id,
  });

  const ownerId =
    typeof lead?.assignedTo === 'object' ? lead.assignedTo?._id : lead?.assignedTo;
  // Mirrors the API's rule — the owner or an organizer. The API enforces it;
  // this only decides whether to offer the button (MOB-2).
  const canTransfer = canEditLead && (isOrganizer || (!!user && ownerId === user._id));

  const invalidateLead = () => {
    qc.invalidateQueries({ queryKey: queryKeys.leads.detail(id) });
    qc.invalidateQueries({ queryKey: queryKeys.leads.all });
    qc.invalidateQueries({ queryKey: queryKeys.leads.stats });
    // A stage change is written to the timeline by the API.
    qc.invalidateQueries({ queryKey: queryKeys.leads.thread(id, 'timeline') });
  };

  const stageMutation = useMutation({
    mutationFn: ({
      stage,
      lostReason,
      nextFollowUpAt,
      reminderMinutesBefore,
    }: {
      stage: LeadStage;
      lostReason?: string;
      nextFollowUpAt?: string;
      reminderMinutesBefore?: number[];
    }) => leadService.updateStage(id, stage, { lostReason, nextFollowUpAt, reminderMinutesBefore }),
    onSuccess: invalidateLead,
    onError: (err: any) => {
      Alert.alert('Error', err?.response?.data?.error?.message || 'Failed to update stage.');
    },
  });

  // A reminder on the lead's current stage is a follow-up date, not a stage
  // change: it goes through the lead itself, so no "moved to…" appears on the
  // timeline for a move that did not happen.
  const reminderMutation = useMutation({
    mutationFn: (input: { nextFollowUpAt: string; reminderMinutesBefore?: number[] }) =>
      leadService.update(id, input),
    onSuccess: invalidateLead,
    onError: (err: any) => {
      Alert.alert('Error', err?.response?.data?.error?.message || 'Failed to set the reminder.');
    },
  });

  const bookmarkMutation = useMutation({
    mutationFn: () => leadService.toggleBookmark(id),
    onSuccess: invalidateLead,
    onError: () => Alert.alert('Error', 'Could not update bookmark.'),
  });

  const handleStagePress = (newStage: LeadStage) => {
    if (!lead || lead.stage === newStage) return;
    if (newStage === 'drop') {
      setDropReason('');
      setDropTag(null);
      setDropReasonOpen(true);
      return;
    }
    // Matches the reference app: changing stage opens "Set Reminder" rather
    // than a plain confirm — the follow-up date/reminders are set right here.
    setReminderStage(newStage);
  };

  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  const handleTabSwipeEnd = (x: number, y: number) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;

    const dx = x - start.x;
    const dy = y - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy) * 1.25) return;

    const activeIndex = TABS.findIndex((item) => item.key === tab);
    const nextIndex = dx < 0 ? activeIndex + 1 : activeIndex - 1;
    const nextTab = TABS[nextIndex];
    if (nextTab) setTab(nextTab.key);
  };

  // Same order and meaning as the reference app: reminder, meeting, then edit.
  // Each icon says what it does — the calendar is the date to call back, and a
  // meeting is people — with the task shortcut marked as a task.
  const headerActions = useMemo<HeaderAction[]>(() => {
    const actions: HeaderAction[] = [
      {
        icon: 'alarm-outline',
        accessibilityLabel: 'Set reminder',
        onPress: () => lead && setReminderStage(lead.stage as LeadStage),
      },
      { icon: 'people-outline', accessibilityLabel: 'Schedule meeting', onPress: () => router.push(`/meeting/create?leadId=${id}`) },
      { icon: 'clipboard-outline', accessibilityLabel: 'Create task', onPress: () => router.push(`/task/create?leadId=${id}`) },
    ];
    if (canTransfer) {
      actions.push({
        icon: 'swap-horizontal-outline',
        accessibilityLabel: t('transfers.action'),
        onPress: () => setTransferOpen(true),
      });
    }
    if (canEditLead) {
      actions.push({ icon: 'create-outline', accessibilityLabel: 'Edit lead', onPress: () => router.push(`/lead/add?edit=${id}`) });
    }
    return actions;
  }, [id, canEditLead, canTransfer, router, lead, t]);

  if (isLoading) {
    return (
      <View style={styles.fill}>
        <ScreenHeader title="Lead Details" />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </View>
    );
  }

  if (!lead) {
    return (
      <View style={styles.fill}>
        <ScreenHeader title="Lead Details" />
        <View style={styles.center}>
          <Text style={styles.errorText}>Lead not found.</Text>
        </View>
      </View>
    );
  }

  const stagePipeline = (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Pipeline Stage</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.pipelineRow}>
          {STAGE_ORDER.map((s) => {
            const meta = LEAD_STAGE_META[s];
            const isCurrent = lead.stage === s;
            const isPast = STAGE_ORDER.indexOf(s) < STAGE_ORDER.indexOf(lead.stage as LeadStage);
            return (
              <TouchableOpacity
                key={s}
                onPress={() => handleStagePress(s)}
                disabled={stageMutation.isPending}
                activeOpacity={0.8}
              >
                <StatusChip label={meta.label} color={meta.color} size="md" filled={isCurrent} dot={isPast && !isCurrent} />
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity onPress={() => handleStagePress('drop')} activeOpacity={0.8}>
            <StatusChip
              label={LEAD_STAGE_META.drop.label}
              color={LEAD_STAGE_META.drop.color}
              size="md"
              filled={lead.stage === 'drop'}
            />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );

  return (
    <View style={styles.fill}>
      <ScreenHeader title="Lead Details" actions={headerActions}>
        {detailsOpen ? (
          // Room below the action buttons for the handle, so it never covers
          // — or takes taps from — the bottom of Bookmark, WhatsApp and Call.
          <View style={{ paddingBottom: HANDLE_OVERLAP }}>
            <LeadDetailHeader
              lead={lead}
              onToggleBookmark={() => bookmarkMutation.mutate()}
              bookmarkPending={bookmarkMutation.isPending}
            />
          </View>
        ) : (
          <TouchableOpacity
            style={styles.collapsedBar}
            onPress={toggleDetails}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('leadHeader.show')}
          >
            <View style={styles.collapsedAvatar}>
              <Text style={styles.collapsedInitials}>{initialsOf(lead.contactName)}</Text>
            </View>
            <Text style={styles.collapsedName} numberOfLines={1}>
              {lead.contactName}
            </Text>
            <StatusChip
              label={(LEAD_STAGE_META[lead.stage] ?? LEAD_STAGE_META.new).label}
              color={(LEAD_STAGE_META[lead.stage] ?? LEAD_STAGE_META.new).color}
              filled
            />
          </TouchableOpacity>
        )}
      </ScreenHeader>

      {detailsOpen ? (
        // Open: a small handle straddles the seam. The view is pulled up by half
        // the handle so the handle stays inside it — Android delivers no touches
        // to the part of a child that hangs outside its parent.
        <View style={styles.tabsWrap}>
          <UnderlineTabs tabs={TABS} active={tab} onChange={setTab} />
          <View style={styles.handleRow} pointerEvents="box-none">
            <TouchableOpacity
              style={styles.handle}
              onPress={toggleDetails}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('leadHeader.hide')}
              accessibilityState={{ expanded: true }}
            >
              <AnimatedChevrons direction="up" size={13} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        // Folded: the whole width becomes the control, as in the reference app —
        // a target nobody has to aim for, with the arrows saying which way it goes.
        <View>
          <TouchableOpacity
            style={styles.foldRow}
            onPress={toggleDetails}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('leadHeader.show')}
            accessibilityState={{ expanded: false }}
          >
            <AnimatedChevrons direction="down" size={13} color={colors.textSecondary} />
          </TouchableOpacity>
          <UnderlineTabs tabs={TABS} active={tab} onChange={setTab} style={styles.tabsUnderFold} />
        </View>
      )}

      {canTransfer && user ? (
        <PendingTransferBanner leadId={id} viewerId={user._id} isOrganizer={isOrganizer} />
      ) : null}

      <View
        style={styles.tabContent}
        onTouchStart={(event) => {
          swipeStart.current = {
            x: event.nativeEvent.pageX,
            y: event.nativeEvent.pageY,
          };
        }}
        onTouchEnd={(event) => {
          handleTabSwipeEnd(event.nativeEvent.pageX, event.nativeEvent.pageY);
        }}
      >
        {THREAD_TABS.has(tab) ? (
          <LeadThreadPanel
            leadId={id}
            channel={tab === 'ask_query' ? 'query' : tab === 'notes' ? 'notes' : 'timeline'}
            placeholder={
              tab === 'ask_query' ? 'Type your query' : tab === 'notes' ? 'Enter Your Notes' : 'Enter Your Comments'
            }
            showCanned={tab !== 'ask_query'}
            header={tab === 'timeline' ? stagePipeline : undefined}
          />
        ) : tab === 'quick_reply' ? (
          <QuickReplyPanel phone={lead.contactPhone} />
        ) : (
          <ScrollView
            contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {tab === 'work' && <LeadWorkPanel leadId={id} />}
            {tab === 'document' && <LeadDocumentsPanel leadId={id} kind="document" />}
            {tab === 'attachment' && <LeadDocumentsPanel leadId={id} kind="attachment" />}
            {tab === 'details' && <LeadClientDetailsPanel lead={lead} />}
            {tab === 'calls' && <LeadCallsPanel leadId={id} />}
          </ScrollView>
        )}
      </View>

      {canTransfer ? (
        <TransferLeadSheet
          visible={transferOpen}
          onDismiss={() => setTransferOpen(false)}
          leadId={id}
          ownerId={ownerId}
          isOrganizer={isOrganizer}
        />
      ) : null}

      <SetReminderDialog
        visible={reminderStage !== null}
        onDismiss={() => setReminderStage(null)}
        initialStage={reminderStage ?? 'new'}
        onSkip={(stage) => {
          // Skipping the reminder on the current stage leaves everything as it was.
          if (stage !== lead.stage) stageMutation.mutate({ stage });
        }}
        onUpdate={(stage, nextFollowUpAt, reminderMinutesBefore) => {
          if (stage === lead.stage) {
            reminderMutation.mutate({ nextFollowUpAt: nextFollowUpAt.toISOString(), reminderMinutesBefore });
            return;
          }
          stageMutation.mutate({ stage, nextFollowUpAt: nextFollowUpAt.toISOString(), reminderMinutesBefore });
        }}
      />

      <CenterDialog visible={dropReasonOpen} onDismiss={() => setDropReasonOpen(false)} title={t('leadDrop.title')}>
        <Text style={styles.dropLabel}>{t('leadDrop.chooseReason')}</Text>
        {dropReasons.isLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (dropReasons.data ?? []).length === 0 ? (
          <Text style={styles.dropEmpty}>{t('leadDrop.noTags')}</Text>
        ) : (
          <View style={styles.tagWrap}>
            {(dropReasons.data ?? []).map((reason) => {
              const selected = dropTag === reason.name;
              return (
                <TouchableOpacity
                  key={reason._id}
                  style={[styles.tag, selected && styles.tagSelected]}
                  onPress={() => setDropTag(selected ? null : reason.name)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.tagText, selected && styles.tagTextSelected]}>{reason.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        {isOrganizer ? (
          <TouchableOpacity
            onPress={() => {
              setDropReasonOpen(false);
              router.push('/lead/drop-reasons');
            }}
            accessibilityRole="link"
          >
            <Text style={styles.manageTags}>{t('leadDrop.manageTags')}</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={styles.dropLabel}>{t('leadDrop.otherLabel')}</Text>
        <TextInput
          value={dropReason}
          onChangeText={setDropReason}
          style={styles.dropInput}
          placeholder={t('leadDrop.otherPlaceholder')}
          placeholderTextColor={colors.textDisabled}
          maxLength={DROP_NOTE_MAX}
          multiline
        />
        <TouchableOpacity
          // A drop needs a reason — a tag, a note, or both.
          style={[styles.dropConfirmBtn, !composeLostReason(dropTag, dropReason) && styles.dropConfirmDisabled]}
          disabled={!composeLostReason(dropTag, dropReason)}
          onPress={() => {
            stageMutation.mutate({ stage: 'drop', lostReason: composeLostReason(dropTag, dropReason) });
            setDropReasonOpen(false);
          }}
        >
          <Text style={styles.dropConfirmText}>{t('leadDrop.confirm')}</Text>
        </TouchableOpacity>
      </CenterDialog>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  tabContent: { flex: 1 },
  // Collapsed summary: enough to know whose lead this is, and one tap to reopen.
  collapsedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingTop: 4,
    paddingBottom: 18,
  },
  collapsedAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapsedInitials: { fontSize: 12.5, fontWeight: '800', color: colors.primary },
  collapsedName: { flex: 1, fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  tabsWrap: { marginTop: -HANDLE_OVERLAP, paddingTop: HANDLE_OVERLAP },
  // The folded control: the panel's own rounded top, lightly tinted, full width.
  foldRow: {
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    // A faint tint sets the row apart from the tabs below it, as the reference
    // app's strip does, so it reads as a control rather than empty space.
    backgroundColor: '#F2F2F4',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  // Under the fold row the tabs are a continuation of the panel, not a second one.
  tabsUnderFold: { borderTopLeftRadius: 0, borderTopRightRadius: 0, elevation: 0, shadowOpacity: 0 },
  handleRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
    elevation: 10,
  },
  handle: {
    width: 44,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 16, color: colors.textSecondary },
  scroll: { padding: spacing.md, gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  pipelineRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 2 },
  dropLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 6 },
  dropEmpty: { fontSize: 13, color: colors.textTertiary },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tag: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: borderRadius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tagSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  tagText: { fontSize: 13, fontWeight: '600', color: colors.text },
  tagTextSelected: { color: '#FFFFFF' },
  manageTags: { fontSize: 13, fontWeight: '700', color: colors.primary, textDecorationLine: 'underline' },
  dropInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.sm,
    minHeight: 80,
    fontSize: 14,
    color: colors.text,
    textAlignVertical: 'top',
  },
  dropConfirmBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  dropConfirmText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  dropConfirmDisabled: { opacity: 0.4 },
});
