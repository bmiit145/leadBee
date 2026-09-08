import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { colors, spacing, borderRadius } from '../theme';
import { LeadStage } from '../types';
import { LEAD_STAGE_META, LEAD_STAGE_ORDER } from '../config/leadStages';
import { CenterDialog, SelectListDialog, MultiReminderPicker } from './ui';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  initialStage: LeadStage;
  onSkip: (stage: LeadStage) => void;
  onUpdate: (stage: LeadStage, nextFollowUpAt: Date, reminderMinutesBefore: number[]) => void;
}

const STAGE_OPTIONS = LEAD_STAGE_ORDER.map((s) => ({ value: s, label: LEAD_STAGE_META[s].label }));

function formatDateTime(d: Date): string {
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
}

/**
 * The "Set Reminder" dialog shown after picking a new stage on Lead Details:
 * Status (defaults to the tapped stage, still editable), a combined Reminder
 * Date & Time field, a stack of reminders (reusing the same repeatable picker
 * Create Meeting uses), and Skip/Update actions. Skip just changes the stage;
 * Update also sets the follow-up + reminders in the same call, matching the
 * backend's combined `PUT /leads/:id/stage` endpoint.
 */
export function SetReminderDialog({ visible, onDismiss, initialStage, onSkip, onUpdate }: Props) {
  const [stage, setStage] = useState<LeadStage>(initialStage);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [dateTime, setDateTime] = useState<Date | null>(null);
  const [pickerStep, setPickerStep] = useState<'date' | 'time' | null>(null);
  const [reminders, setReminders] = useState<number[]>([]);

  useEffect(() => {
    if (visible) {
      setStage(initialStage);
      setDateTime(null);
      setReminders([]);
    }
  }, [visible, initialStage]);

  const openDateTimePicker = () => setPickerStep('date');

  const handleDateChange = (_: any, selected?: Date) => {
    if (Platform.OS === 'android') setPickerStep(null);
    if (!selected) return;
    const base = dateTime ?? new Date();
    const next = new Date(selected);
    next.setHours(base.getHours(), base.getMinutes());
    setDateTime(next);
    if (Platform.OS === 'android') setPickerStep('time');
  };

  const handleTimeChange = (_: any, selected?: Date) => {
    if (Platform.OS === 'android') setPickerStep(null);
    if (!selected || !dateTime) return;
    const next = new Date(dateTime);
    next.setHours(selected.getHours(), selected.getMinutes());
    setDateTime(next);
  };

  return (
    <CenterDialog visible={visible} onDismiss={onDismiss} title="Set Reminder">
      <Text style={styles.label}>Status</Text>
      <TouchableOpacity style={styles.statusField} onPress={() => setStatusPickerOpen(true)}>
        <Text style={styles.statusText}>{LEAD_STAGE_META[stage].label}</Text>
        <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
      </TouchableOpacity>

      <Text style={styles.label}>Reminder Date and Time</Text>
      <TouchableOpacity style={styles.field} onPress={openDateTimePicker}>
        <Text style={[styles.fieldText, !dateTime && styles.fieldPlaceholder]}>
          {dateTime ? formatDateTime(dateTime) : 'Select Reminder Date and Time'}
        </Text>
        <Ionicons name="calendar" size={18} color={colors.primary} />
      </TouchableOpacity>

      <Text style={styles.label}>Receive Notification</Text>
      <MultiReminderPicker values={reminders} onChange={setReminders} />

      <View style={styles.footer}>
        <TouchableOpacity style={styles.skipBtn} onPress={() => { onSkip(stage); onDismiss(); }}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.updateBtn, !dateTime && styles.updateBtnDisabled]}
          onPress={() => {
            if (!dateTime) return;
            onUpdate(stage, dateTime, reminders);
            onDismiss();
          }}
          disabled={!dateTime}
        >
          <Text style={styles.updateText}>Update</Text>
        </TouchableOpacity>
      </View>

      <SelectListDialog
        visible={statusPickerOpen}
        onDismiss={() => setStatusPickerOpen(false)}
        title="Status"
        options={STAGE_OPTIONS}
        value={stage}
        onSelect={(v) => setStage(v as LeadStage)}
      />

      {pickerStep === 'date' && (
        <DateTimePicker
          value={dateTime ?? new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'calendar'}
          onChange={handleDateChange}
        />
      )}
      {pickerStep === 'time' && (
        <DateTimePicker
          value={dateTime ?? new Date()}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'clock'}
          onChange={handleTimeChange}
        />
      )}
    </CenterDialog>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 6, marginTop: spacing.xs },
  statusField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: `${colors.primary}0F`,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    marginBottom: spacing.sm,
  },
  statusText: { fontSize: 15, fontWeight: '700', color: colors.text },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    marginBottom: spacing.sm,
  },
  fieldText: { fontSize: 14, color: colors.text, fontWeight: '600' },
  fieldPlaceholder: { color: colors.textDisabled, fontWeight: '500' },
  footer: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  skipBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingVertical: 12,
    alignItems: 'center',
  },
  skipText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  updateBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingVertical: 12,
    alignItems: 'center',
  },
  updateBtnDisabled: { backgroundColor: colors.textDisabled },
  updateText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});
