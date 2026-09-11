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
} from 'react-native';
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
import { ScreenHeader, UnderlineTabs, StatusChip, CenterDialog } from '../../src/components/ui';
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
  { key: 'quick_reply', label: 'Quick Reply' },
  { key: 'document', label: 'Document' },
  { key: 'attachment', label: 'Attachment' },
  { key: 'details', label: 'Client Details' },
  { key: 'ask_query', label: 'Ask Query' },
  { key: 'notes', label: 'Notes' },
  { key: 'calls', label: 'Calls' },
];

const THREAD_TABS = new Set(['timeline', 'ask_query', 'notes']);

export default function LeadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, isOrganizer } = useAuth();
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [tab, setTab] = useState('timeline');
  const [reminderStage, setReminderStage] = useState<LeadStage | null>(null);
  const [dropReasonOpen, setDropReasonOpen] = useState(false);
  const [dropReason, setDropReason] = useState('');
  const [dropTag, setDropTag] = useState<string | null>(null);

  const dropReasons = useQuery({
    queryKey: queryKeys.lookups.dropReasons,
    queryFn: () => dropReasonService.list(),
    enabled: dropReasonOpen,
    staleTime: 5 * 60_000,
  });

  const isAdmin = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'owner';

  const { data: lead, isLoading } = useQuery({
    queryKey: queryKeys.leads.detail(id),
    queryFn: () => leadService.getById(id),
    enabled: !!id,
  });

  const invalidateLead = () => {
    qc.invalidateQueries({ queryKey: queryKeys.leads.detail(id) });
    qc.invalidateQueries({ queryKey: queryKeys.leads.all });
    qc.invalidateQueries({ queryKey: queryKeys.leads.stats });
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
      Alert.alert('Error', err?.response?.data?.message || 'Failed to update stage.');
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

  const headerActions = useMemo<HeaderAction[]>(() => {
    const actions: HeaderAction[] = [
      { icon: 'calendar-outline', accessibilityLabel: 'Schedule meeting', onPress: () => router.push(`/meeting/create?leadId=${id}`) },
      { icon: 'people-outline', accessibilityLabel: 'Create task', onPress: () => router.push(`/task/create?leadId=${id}`) },
    ];
    if (isAdmin) {
      actions.push({ icon: 'create-outline', accessibilityLabel: 'Edit lead', onPress: () => router.push(`/lead/add?edit=${id}`) });
    }
    return actions;
  }, [id, isAdmin, router]);

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
        <LeadDetailHeader
          lead={lead}
          onToggleBookmark={() => bookmarkMutation.mutate()}
          bookmarkPending={bookmarkMutation.isPending}
        />
      </ScreenHeader>

      <UnderlineTabs tabs={TABS} active={tab} onChange={setTab} />

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
            {tab === 'document' && <LeadDocumentsPanel leadId={id} kind="document" />}
            {tab === 'attachment' && <LeadDocumentsPanel leadId={id} kind="attachment" />}
            {tab === 'details' && <LeadClientDetailsPanel lead={lead} />}
            {tab === 'calls' && <LeadCallsPanel leadId={id} />}
          </ScrollView>
        )}
      </View>

      <SetReminderDialog
        visible={reminderStage !== null}
        onDismiss={() => setReminderStage(null)}
        initialStage={reminderStage ?? 'new'}
        onSkip={(stage) => stageMutation.mutate({ stage })}
        onUpdate={(stage, nextFollowUpAt, reminderMinutesBefore) =>
          stageMutation.mutate({ stage, nextFollowUpAt: nextFollowUpAt.toISOString(), reminderMinutesBefore })
        }
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
          style={styles.dropConfirmBtn}
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
});
