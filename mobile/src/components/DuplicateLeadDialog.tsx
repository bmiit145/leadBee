import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, borderRadius } from '../theme';
import { LEAD_STAGE_META } from '../config/leadStages';
import type { DuplicateMatch } from '../services/lead.service';

interface Props {
  visible: boolean;
  total: number;
  matches: DuplicateMatch[];
  /** Editing an existing lead: the override reads "Save anyway". */
  editing?: boolean;
  /**
   * `live` — raised while the number is typed; the override continues filling
   * the form. `save` — raised by saving; the override saves.
   */
  mode?: 'live' | 'save';
  onClose: () => void;
  onViewLead: (leadId: string) => void;
  onCreateAnyway: () => void;
}

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

/**
 * "This number already belongs to a lead" — shown while the number is typed and
 * again if saving meets one.
 *
 * The first match is shown in full; when there are more, cards stack behind it
 * with a "+N" badge, and the whole list opens in place. A match the person may
 * not open still shows its number, stage, owner and date — enough to know it
 * exists and whom to ask — without the customer's name.
 *
 * Viewing the existing lead is the primary action; creating another is the
 * deliberate override, as in Salesforce's "Save anyway" and HubSpot's duplicate
 * warning.
 */
export function DuplicateLeadDialog({
  visible,
  total,
  matches,
  editing,
  mode = 'save',
  onClose,
  onViewLead,
  onCreateAnyway,
}: Props) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);

  // A fresh set of matches starts collapsed.
  useEffect(() => {
    if (visible) setShowAll(false);
  }, [visible, matches]);

  const first = matches[0];
  if (!first) return null;

  const more = Math.max(0, total - 1);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.dialog} onPress={() => undefined}>
          <View style={styles.head}>
            <View style={styles.warnIcon}>
              <Ionicons name="alert-circle" size={22} color={colors.error} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{t('duplicates.title')}</Text>
              <Text style={styles.subtitle}>{t('duplicates.subtitle', { count: total })}</Text>
            </View>
          </View>

          {showAll ? (
            <ScrollView style={styles.list} contentContainerStyle={{ gap: 8 }}>
              {matches.map((match) => (
                <MatchRow
                  key={match.leadNumber}
                  match={match}
                  onPress={match.canView && match.leadId ? () => onViewLead(match.leadId!) : undefined}
                />
              ))}
              {total > matches.length ? (
                <Text style={styles.overflowNote}>
                  {t('duplicates.moreNotShown', { count: total - matches.length })}
                </Text>
              ) : null}
            </ScrollView>
          ) : (
            <View style={styles.stackWrap}>
              {/* Cards peeking out below say "there is more" before any number does. */}
              {more >= 2 ? <View style={[styles.ghost, styles.ghostBack]} /> : null}
              {more >= 1 ? <View style={[styles.ghost, styles.ghostMid]} /> : null}
              <MatchCard match={first} />
              {more > 0 ? (
                <View style={styles.moreBadge} accessibilityLabel={t('duplicates.moreLabel', { count: more })}>
                  <Text style={styles.moreBadgeText}>+{more}</Text>
                </View>
              ) : null}
            </View>
          )}

          {more > 0 ? (
            <TouchableOpacity
              style={styles.viewAll}
              onPress={() => setShowAll((open) => !open)}
              accessibilityRole="button"
            >
              <Text style={styles.viewAllText}>
                {showAll ? t('duplicates.showLess') : t('duplicates.viewAll', { count: total })}
              </Text>
              <Ionicons name={showAll ? 'chevron-up' : 'chevron-down'} size={16} color={colors.primary} />
            </TouchableOpacity>
          ) : null}

          <View style={styles.actions}>
            {first.canView && first.leadId && !showAll ? (
              <TouchableOpacity
                style={[styles.button, styles.primary]}
                onPress={() => onViewLead(first.leadId!)}
                accessibilityRole="button"
              >
                <Ionicons name="open-outline" size={16} color="#FFFFFF" />
                <Text style={styles.primaryText}>{t('duplicates.viewLead')}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.button, styles.secondary]}
              onPress={onCreateAnyway}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryText}>
                {mode === 'live'
                  ? t('duplicates.continueAnyway')
                  : editing
                    ? t('duplicates.saveAnyway')
                    : t('duplicates.createAnyway')}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.cancel} onPress={onClose} accessibilityRole="button">
            <Text style={styles.cancelText}>{t('duplicates.cancel')}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function StageChip({ stage }: { stage: DuplicateMatch['stage'] }) {
  const meta = LEAD_STAGE_META[stage] ?? LEAD_STAGE_META.new;
  return (
    <View style={[styles.stageChip, { backgroundColor: `${meta.color}14`, borderColor: `${meta.color}40` }]}>
      <View style={[styles.stageDot, { backgroundColor: meta.color }]} />
      <Text style={styles.stageText}>{meta.label}</Text>
    </View>
  );
}

function MatchCard({ match }: { match: DuplicateMatch }) {
  const { t } = useTranslation();
  const rows: { label: string; value: string; muted?: boolean }[] = [
    {
      label: t('duplicates.customer'),
      value: match.canView && match.contactName
        ? match.contactName
        : t('duplicates.restricted', { owner: match.assignedToName ?? t('duplicates.anotherMember') }),
      muted: !match.canView,
    },
    { label: t('duplicates.mobile'), value: match.matchedPhone },
    { label: t('duplicates.assignedTo'), value: match.assignedToName ?? t('duplicates.unassigned') },
    { label: t('duplicates.createdBy'), value: match.createdByName ?? '—' },
    { label: t('duplicates.createdOn'), value: dateLabel(match.createdAt) },
  ];

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.leadNumber}>
          <Ionicons name="person-circle-outline" size={15} color={colors.textSecondary} />
          <Text style={styles.leadNumberText}>{match.leadNumber}</Text>
        </View>
        <StageChip stage={match.stage} />
      </View>
      {rows.map((row, index) => (
        <View key={row.label} style={[styles.row, index > 0 && styles.rowDivided]}>
          <Text style={styles.rowLabel}>{row.label}</Text>
          <View style={styles.rowValueWrap}>
            {row.muted ? <Ionicons name="lock-closed-outline" size={12} color={colors.textSecondary} /> : null}
            <Text style={[styles.rowValue, row.muted && styles.rowValueMuted]} numberOfLines={1}>
              {row.value}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** One line per match in the expanded list. */
function MatchRow({ match, onPress }: { match: DuplicateMatch; onPress?: () => void }) {
  const { t } = useTranslation();
  const meta = LEAD_STAGE_META[match.stage] ?? LEAD_STAGE_META.new;
  return (
    <TouchableOpacity
      style={styles.matchRow}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.75}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <View style={[styles.stageDot, styles.rowDot, { backgroundColor: meta.color }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.matchName} numberOfLines={1}>
          {match.canView && match.contactName ? match.contactName : match.matchedPhone}
        </Text>
        <Text style={styles.matchMeta} numberOfLines={1}>
          {match.leadNumber} · {meta.label} · {match.assignedToName ?? t('duplicates.unassigned')}
        </Text>
      </View>
      {onPress ? (
        <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
      ) : (
        <Ionicons name="lock-closed-outline" size={14} color={colors.textSecondary} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  dialog: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xxl,
    padding: spacing.lg,
    maxHeight: '88%',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: spacing.md },
  warnIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: `${colors.error}14`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  stackWrap: { paddingBottom: 14 },
  ghost: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  ghostMid: { transform: [{ translateY: 7 }, { scaleX: 0.95 }] },
  ghostBack: { transform: [{ translateY: 14 }, { scaleX: 0.9 }], backgroundColor: colors.background },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  leadNumber: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  leadNumberText: { fontSize: 13, fontWeight: '800', color: colors.text, letterSpacing: 0.3 },
  stageChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  stageDot: { width: 7, height: 7, borderRadius: 3.5 },
  stageText: { fontSize: 11.5, fontWeight: '700', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  rowDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowLabel: { width: 100, fontSize: 12.5, color: colors.textSecondary },
  rowValueWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
  rowValue: { flex: 1, fontSize: 13.5, fontWeight: '600', color: colors.text },
  rowValueMuted: { fontWeight: '500', color: colors.textSecondary, fontStyle: 'italic' },
  moreBadge: {
    position: 'absolute',
    top: -8,
    right: -6,
    minWidth: 30,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 8,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreBadgeText: { fontSize: 12, fontWeight: '800', color: '#FFFFFF' },
  viewAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
  },
  viewAllText: { fontSize: 13.5, fontWeight: '700', color: colors.primary },
  list: { maxHeight: 300 },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.sm,
    backgroundColor: colors.surface,
  },
  rowDot: { marginLeft: 4 },
  matchName: { fontSize: 14, fontWeight: '700', color: colors.text },
  matchMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  overflowNote: { fontSize: 12, color: colors.textSecondary, textAlign: 'center', paddingVertical: 4 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: borderRadius.full,
    paddingVertical: 13,
  },
  primary: { backgroundColor: colors.primary },
  primaryText: { fontSize: 14.5, fontWeight: '700', color: '#FFFFFF' },
  secondary: { borderWidth: 1.5, borderColor: colors.primary },
  secondaryText: { fontSize: 14.5, fontWeight: '700', color: colors.primary },
  cancel: { alignItems: 'center', paddingTop: 12 },
  cancelText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
});
