import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Lead } from '../types';
import { colors, spacing, borderRadius } from '../theme';
import { LEAD_STAGE_META } from '../config/leadStages';
import { StatusChip, Avatar } from './ui';

interface Props {
  lead: Lead;
}

/** Read-only lead identity card at the top of Create Meeting / Create Task
 *  when launched from a lead's context — avatar, name, phone (with copy),
 *  LEAD/SOURCE rows, and the dot-style stage chip. Matches the reference
 *  app's Create Meeting screen exactly. */
export function LeadSummaryCard({ lead }: Props) {
  const stage = LEAD_STAGE_META[lead.stage] ?? LEAD_STAGE_META.new;
  const budgetLabel = formatBudget(lead.budgetMin, lead.budgetMax);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Avatar icon="person" size={40} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{lead.contactName}</Text>
          <View style={styles.phoneRow}>
            <Text style={styles.phone}>{lead.contactPhone}</Text>
            <TouchableOpacity
              style={styles.copyBtn}
              onPress={() => Clipboard.setStringAsync(lead.contactPhone)}
            >
              <Ionicons name="copy" size={11} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>LEAD</Text>
        <Text style={styles.metaColon}>:</Text>
        <Text style={styles.metaValue}>
          {new Date(lead.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
        </Text>
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>SOURCE</Text>
        <Text style={styles.metaColon}>:</Text>
        <Text style={styles.metaValue}>{lead.sourceDetail || sourceLabel(lead.source)}</Text>
      </View>

      <View style={styles.chipRow}>
        <StatusChip label={stage.label} color={stage.color} dot />
        {budgetLabel ? (
          <View style={styles.budgetPill}>
            <Text style={styles.budgetText}>{budgetLabel}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** "walk_in" -> "Walk In", "99acres" -> "99ACRES". */
function sourceLabel(source: string): string {
  return source
    .split('_')
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/** Compact ₹ label, e.g. 1500000 -> "₹15L". Returns null when no budget is set. */
function formatBudget(min?: number, max?: number): string | null {
  const value = max ?? min;
  if (!value || value <= 0) return null;
  if (value >= 10_000_000) return `₹${+(value / 10_000_000).toFixed(2)}Cr`;
  if (value >= 100_000) return `₹${+(value / 100_000).toFixed(2)}L`;
  if (value >= 1_000) return `₹${+(value / 1_000).toFixed(2)}K`;
  return `₹${value}`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    borderColor: `${colors.primary}30`,
    padding: spacing.md,
    gap: 8,
    marginBottom: spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 },
  phone: { fontSize: 12.5, color: colors.primary, fontWeight: '600' },
  copyBtn: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  metaRow: { flexDirection: 'row', gap: 6 },
  metaLabel: { fontSize: 12, fontWeight: '700', color: colors.text, minWidth: 60 },
  metaColon: { fontSize: 12, color: colors.text },
  metaValue: { fontSize: 12, color: colors.textSecondary, flex: 1 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.xs },
  budgetPill: {
    backgroundColor: `${colors.primary}20`,
    borderWidth: 1,
    borderColor: `${colors.primary}55`,
    borderRadius: borderRadius.md,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  budgetText: { fontSize: 13, fontWeight: '700', color: colors.primary },
});
