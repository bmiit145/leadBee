import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { colors, spacing, borderRadius } from '../theme';
import { SLOT_DURATIONS } from '../config/taskMeeting';
import { meetingService } from '../services/meeting.service';
import { MeetingSlot } from '../types';
import { BottomSheet } from './ui';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  date: Date;
  assignedTo: string[];
  initialDurationMinutes?: number;
  excludeMeetingId?: string;
  onApply: (slot: {
    start: string;
    end: string;
    durationMinutes: number;
    /** How many slots were free for that day/duration, for the caller's summary line. */
    freeCount: number;
  }) => void;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/**
 * "Select meeting time" — duration chip row, a Selected/Available/Busy-past
 * legend, and a scrollable slot list coloured per state. Backs directly onto
 * the already-built GET /meetings/slots endpoint.
 */
export function MeetingSlotSheet({
  visible,
  onDismiss,
  date,
  assignedTo,
  initialDurationMinutes = 30,
  excludeMeetingId,
  onApply,
}: Props) {
  const [duration, setDuration] = useState(initialDurationMinutes);
  const [selected, setSelected] = useState<MeetingSlot | null>(null);

  const dateISO = date.toISOString().slice(0, 10);
  const { data, isLoading } = useQuery({
    queryKey: ['meeting-slots', dateISO, duration, assignedTo.join(','), excludeMeetingId],
    queryFn: () => meetingService.getSlots(dateISO, duration, assignedTo, excludeMeetingId),
    enabled: visible,
  });

  const handleApply = () => {
    if (!selected) return;
    onApply({
      start: selected.start,
      end: selected.end,
      durationMinutes: duration,
      freeCount: data?.availableCount ?? 0,
    });
    onDismiss();
  };

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} maxHeightRatio={0.88}>
      <Text style={styles.title}>Select meeting time</Text>
      <Text style={styles.subtitle}>
        {data ? `${data.availableCount} available · ${duration} min slots` : '—'}
      </Text>

      <Text style={styles.sectionLabel}>Slot duration</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {SLOT_DURATIONS.map((d) => {
            const active = d.minutes === duration;
            return (
              <TouchableOpacity
                key={d.minutes}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => { setDuration(d.minutes); setSelected(null); }}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{d.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
          <Text style={styles.legendText}>Selected</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#2C7A57' }]} />
          <Text style={styles.legendText}>Available</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.textDisabled }]} />
          <Text style={styles.legendText}>Busy / past</Text>
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing.lg }} />
      ) : (
        <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
          {(data?.slots ?? []).map((slot) => {
            const isSelected = selected?.start === slot.start;
            const disabled = slot.state !== 'free';
            return (
              <TouchableOpacity
                key={slot.start}
                disabled={disabled}
                onPress={() => setSelected(slot)}
                style={[
                  styles.slotRow,
                  slot.state === 'past' && styles.slotPast,
                  slot.state === 'busy' && styles.slotBusy,
                  slot.state === 'free' && styles.slotFree,
                  isSelected && styles.slotSelected,
                ]}
              >
                <Ionicons
                  name={isSelected ? 'checkmark-circle' : 'time-outline'}
                  size={18}
                  color={isSelected ? colors.primary : slot.state === 'free' ? '#2C7A57' : colors.textDisabled}
                />
                <Text style={[styles.slotTime, isSelected && styles.slotTimeSelected]}>
                  {fmtTime(slot.start)} – {fmtTime(slot.end)}
                </Text>
                <View
                  style={[
                    styles.statePill,
                    slot.state === 'free' && styles.statePillFree,
                    isSelected && styles.statePillSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.statePillText,
                      slot.state === 'free' && styles.statePillTextFree,
                      isSelected && styles.statePillTextSelected,
                    ]}
                  >
                    {isSelected ? 'Selected' : slot.state === 'free' ? 'Free' : slot.state === 'past' ? 'Past' : 'Busy'}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <TouchableOpacity
        style={[styles.applyBtn, !selected && styles.applyBtnDisabled]}
        onPress={handleApply}
        disabled={!selected}
      >
        <Text style={styles.applyText}>Apply</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '700', color: colors.primary, textAlign: 'center' },
  subtitle: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: 2, marginBottom: spacing.md },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: borderRadius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  chipTextActive: { color: '#FFFFFF' },
  legendRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11.5, color: colors.textSecondary, fontWeight: '600' },
  slotRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: borderRadius.lg, paddingVertical: 12, paddingHorizontal: spacing.md,
    marginBottom: 8, borderWidth: 1.5, borderColor: 'transparent',
  },
  slotPast: { backgroundColor: colors.background },
  slotBusy: { backgroundColor: '#FEE2E2' },
  slotFree: { backgroundColor: '#2C7A5714' },
  slotSelected: { backgroundColor: `${colors.primary}14`, borderColor: colors.primary },
  slotTime: { flex: 1, fontSize: 14.5, fontWeight: '700', color: colors.text },
  slotTimeSelected: { color: colors.primary },
  statePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: borderRadius.full, backgroundColor: colors.surfaceVariant },
  statePillFree: { backgroundColor: '#2C7A5722' },
  statePillSelected: { backgroundColor: colors.primary },
  statePillText: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  statePillTextFree: { color: '#2C7A57' },
  statePillTextSelected: { color: '#FFFFFF' },
  applyBtn: { backgroundColor: colors.primary, borderRadius: borderRadius.full, paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  applyBtnDisabled: { backgroundColor: colors.textDisabled },
  applyText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});
