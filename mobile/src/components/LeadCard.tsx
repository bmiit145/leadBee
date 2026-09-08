import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lead } from '../types';
import { colors, spacing, borderRadius } from '../theme';
import { LEAD_STAGE_META, TERMINAL_LEAD_STAGES } from '../config/leadStages';
import { leadService } from '../services/lead.service';
import { StatusChip, ReminderRow, LeadQuickActions, Avatar } from './ui';

interface Props {
  lead: Lead;
  onPress: () => void;
  /** Only "New" leads show the header delete button in the reference app —
   *  once a lead has moved forward it's no longer a one-tap throwaway. Pass
   *  this to let the card offer it. */
  onDelete?: (lead: Lead) => void;
}

function sourceLabel(source: string): string {
  return source
    .split('_')
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * The lead card used everywhere a lead appears as a list row: the Leads list,
 * and Lead-type entries on the Reminder screen and Home's "Today's Reminder" -
 * same component in all three, matching the reference app.
 */
export function LeadCard({ lead, onPress, onDelete }: Props) {
  const qc = useQueryClient();
  const stage = LEAD_STAGE_META[lead.stage] ?? LEAD_STAGE_META.new;
  const assignedName =
    typeof lead.assignedTo === 'object' && lead.assignedTo !== null
      ? (lead.assignedTo as any).name
      : null;

  // A won or dropped lead can't be "overdue" — nothing further is expected of it.
  const isOverdue =
    !!lead.nextFollowUpAt &&
    new Date(lead.nextFollowUpAt) < new Date() &&
    !TERMINAL_LEAD_STAGES.includes(lead.stage);

  const [optimisticBookmark, setOptimisticBookmark] = useState<boolean | null>(null);
  const isBookmarked = optimisticBookmark ?? lead.isBookmarked;

  const bookmarkMutation = useMutation({
    mutationFn: () => leadService.toggleBookmark(lead._id),
    onMutate: () => setOptimisticBookmark(!isBookmarked),
    onSuccess: (updated) => {
      setOptimisticBookmark(updated.isBookmarked);
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: () => {
      setOptimisticBookmark(null);
      Alert.alert('Error', 'Could not update bookmark.');
    },
  });

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.body} onPress={onPress} activeOpacity={0.75}>
        {/* Header: avatar, name, phone */}
        <View style={styles.headerRow}>
          <Avatar icon="person" size={40} />
          <View style={styles.identityText}>
            <Text style={styles.name} numberOfLines={1}>{lead.contactName}</Text>
            <View style={styles.phoneRow}>
              <Text style={styles.phone}>{lead.contactPhone}</Text>
              <TouchableOpacity
                style={styles.copyBtn}
                onPress={async () => {
                  await Clipboard.setStringAsync(lead.contactPhone);
                }}
                accessibilityLabel="Copy phone number"
              >
                <Ionicons name="copy" size={11} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>
          {onDelete && lead.stage === 'new' ? (
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => onDelete(lead)}
              accessibilityLabel="Delete lead"
            >
              <Ionicons name="trash" size={15} color="#FFFFFF" />
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.divider} />

        {/* Meta: LEAD DATE / SOURCE */}
        <View style={styles.metaGrid}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>LEAD DATE</Text>
            <Text style={styles.metaColon}>:</Text>
            <Text style={styles.metaValue}>
              {new Date(lead.createdAt).toLocaleDateString('en-GB', {
                day: '2-digit', month: '2-digit', year: 'numeric',
              })}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>SOURCE</Text>
            <Text style={styles.metaColon}>:</Text>
            <Text style={styles.metaValue} numberOfLines={1}>
              {lead.sourceDetail || sourceLabel(lead.source)}
            </Text>
          </View>
        </View>

        <View style={styles.tagsRow}>
          <StatusChip label={stage.label} color={stage.color} dot />
          {assignedName ? (
            <View style={styles.assignedTag}>
              <Ionicons name="person-outline" size={11} color={colors.textSecondary} />
              <Text style={styles.assignedText} numberOfLines={1}>{assignedName}</Text>
            </View>
          ) : null}
          {isOverdue ? (
            <View style={styles.overduePill}>
              <Ionicons name="alert-circle" size={11} color="#EF4444" />
              <Text style={styles.overdueText}>Overdue</Text>
            </View>
          ) : null}
        </View>

        {lead.nextFollowUpAt ? <ReminderRow date={lead.nextFollowUpAt} /> : null}
      </TouchableOpacity>

      <LeadQuickActions
        phone={lead.contactPhone}
        isBookmarked={isBookmarked}
        onToggleBookmark={() => bookmarkMutation.mutate()}
        bookmarkPending={bookmarkMutation.isPending}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    borderColor: `${colors.primary}30`,
    marginBottom: 10,
    padding: spacing.md,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  body: { gap: 10 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  identityText: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 },
  phone: { fontSize: 12.5, color: colors.primary, fontWeight: '600' },
  copyBtn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  metaGrid: { gap: 3 },
  metaRow: { flexDirection: 'row', gap: 6 },
  metaLabel: { fontSize: 12, fontWeight: '700', color: colors.text, minWidth: 74 },
  metaColon: { fontSize: 12, color: colors.text },
  metaValue: { fontSize: 12, color: colors.textSecondary, flex: 1 },
  tagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  assignedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  assignedText: { fontSize: 11, color: colors.textSecondary, maxWidth: 90 },
  overduePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#EF444415',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 99,
  },
  overdueText: { fontSize: 11, color: '#EF4444', fontWeight: '700' },
});
