import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Lead } from '../types';
import { colors, spacing, borderRadius } from '../theme';
import { Avatar, StatusChip, LeadQuickActions } from './ui';
import { LEAD_STAGE_META } from '../config/leadStages';

interface Props {
  lead: Lead;
  onToggleBookmark: () => void;
  bookmarkPending?: boolean;
}

function fmtDayMonth(iso?: string): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function fmtValue(lead: Lead): string | null {
  const { budgetMin, budgetMax } = lead;
  if (!budgetMin && !budgetMax) return null;
  const n = (v?: number) => `₹${(v ?? 0).toLocaleString('en-IN')}`;
  if (budgetMin && budgetMax) return `${n(budgetMin)}–${n(budgetMax)}`;
  return n(budgetMax || budgetMin);
}

/**
 * The lead's identity block shown inside the ScreenHeader's primary band on the
 * Lead Details screen: contact card, status chips, key facts and the shared
 * Bookmark / WhatsApp / Call bar. Mirrors the reference app's header, using the
 * MadhavMMS theme rather than re-styling per screen.
 */
export function LeadDetailHeader({ lead, onToggleBookmark, bookmarkPending }: Props) {
  const stage = LEAD_STAGE_META[lead.stage];
  const value = fmtValue(lead);
  const reminder = fmtDayMonth(lead.nextFollowUpAt);

  const facts: { label: string; value: string }[] = [
    { label: 'Client ID', value: lead.leadNumber },
    { label: 'Lead Date', value: fmtDate(lead.createdAt) },
    { label: 'Source', value: lead.source.replace(/_/g, ' ').toUpperCase() },
  ];

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Avatar name={lead.contactName} size={44} variant="tint" />
        <View style={styles.identity}>
          <Text style={styles.name} numberOfLines={1}>{lead.contactName}</Text>
          <View style={styles.phoneRow}>
            <Text style={styles.phone} numberOfLines={1}>{lead.contactPhone}</Text>
            <TouchableOpacity
              onPress={() => Clipboard.setStringAsync(lead.contactPhone)}
              hitSlop={8}
              accessibilityLabel="Copy phone number"
            >
              <Ionicons name="copy-outline" size={14} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={styles.chips}>
        <StatusChip label={stage?.label ?? lead.stage} color={stage?.color ?? colors.primary} size="md" />
        {value ? <StatusChip label={value} color="#FFFFFF" size="md" style={styles.plainChip} /> : null}
        {reminder ? (
          <StatusChip label={reminder} color="#FFFFFF" size="md" icon="notifications-outline" style={styles.plainChip} />
        ) : null}
      </View>

      <View style={styles.facts}>
        {facts.map((f) => (
          <View key={f.label} style={styles.factRow}>
            <Text style={styles.factLabel}>{f.label}</Text>
            <Text style={styles.factSep}>:</Text>
            <Text style={styles.factValue} numberOfLines={1}>{f.value}</Text>
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        <LeadQuickActions
          phone={lead.contactPhone}
          isBookmarked={lead.isBookmarked}
          onToggleBookmark={onToggleBookmark}
          bookmarkPending={bookmarkPending}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, gap: spacing.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.sm,
  },
  identity: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  phone: { fontSize: 12.5, color: colors.textTertiary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  plainChip: { backgroundColor: `${colors.surface}22`, borderColor: `${colors.surface}55` },
  facts: { gap: 2 },
  factRow: { flexDirection: 'row', alignItems: 'center' },
  factLabel: { width: 78, fontSize: 11, fontWeight: '700', color: `${colors.surface}CC`, textTransform: 'uppercase', letterSpacing: 0.3 },
  factSep: { fontSize: 11, color: `${colors.surface}CC`, marginRight: 6 },
  factValue: { flex: 1, fontSize: 12, fontWeight: '600', color: '#FFFFFF' },
  actions: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.full,
    marginTop: spacing.xs,
  },
});
