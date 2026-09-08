import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '../../theme';

interface Props {
  /** ISO date string. */
  date: string;
}

const DATE_TINT = '#F4839014';

function formatDatePill(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTimePill(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/**
 * The bell + date + time strip a card gains once a follow-up reminder is set.
 * Appears on LeadCard between the status chip and the action bar, and on Home's
 * "Today's Reminder" feed — same component in both places.
 */
export function ReminderRow({ date }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.bell}>
        <Ionicons name="notifications" size={14} color="#FFFFFF" />
      </View>
      <View style={styles.datePill}>
        <Text style={styles.dateText}>{formatDatePill(date)}</Text>
      </View>
      <View style={styles.timePill}>
        <Text style={styles.timeText}>{formatTimePill(date)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: DATE_TINT,
    borderRadius: borderRadius.full,
    padding: 4,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  bell: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#D64545',
    alignItems: 'center',
    justifyContent: 'center',
  },
  datePill: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  dateText: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
  timePill: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  timeText: { fontSize: 12.5, fontWeight: '700', color: '#FFFFFF' },
});
