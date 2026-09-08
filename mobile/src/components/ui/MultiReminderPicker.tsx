import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '../../theme';
import { REMINDER_OPTIONS } from '../../config/taskMeeting';
import { SelectListDialog } from './SelectListDialog';

interface Props {
  /** Minutes-before values, one per stacked reminder. */
  values: number[];
  onChange: (values: number[]) => void;
}

const NON_NONE_OPTIONS = REMINDER_OPTIONS.filter((o) => o.value !== null) as {
  value: number;
  label: string;
}[];

function labelFor(minutes: number): string {
  return NON_NONE_OPTIONS.find((o) => o.value === minutes)?.label ?? `${minutes} Minutes before`;
}

/**
 * The repeatable "Set Reminder" list from Create Meeting: each stacked
 * reminder renders as a numbered pill row (1, 2, 3...), tapping a row lets you
 * change its value via the Choose Reminder dialog, and a trailing "+" appends
 * a new row. A small "x" per row removes it — not directly seen in the
 * reference screenshots, but a necessary affordance since values can't
 * otherwise be taken back out once added.
 */
export function MultiReminderPicker({ values, onChange }: Props) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const availableForNewRow = NON_NONE_OPTIONS.filter((o) => !values.includes(o.value));
  const optionsForEditing =
    editingIndex !== null
      ? NON_NONE_OPTIONS.filter(
          (o) => !values.includes(o.value) || o.value === values[editingIndex]
        )
      : [];

  const addRow = () => {
    if (availableForNewRow.length === 0) return;
    setEditingIndex(values.length);
  };

  const removeRow = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  const rows: (number | null)[] = editingIndex === values.length ? [...values, null] : values;

  return (
    <View>
      {rows.map((minutes, index) => (
        <View key={index} style={styles.rowWrap}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => setEditingIndex(index)}
            activeOpacity={0.75}
          >
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{index + 1}</Text>
            </View>
            <Text style={[styles.label, minutes === null && styles.labelPlaceholder]} numberOfLines={1}>
              {minutes === null ? 'Select Reminder' : labelFor(minutes)}
            </Text>
          </TouchableOpacity>
          {minutes !== null && (
            <TouchableOpacity style={styles.removeBtn} onPress={() => removeRow(index)}>
              <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
          {index === rows.length - 1 && availableForNewRow.length > 0 && minutes !== null && (
            <TouchableOpacity style={styles.addBtn} onPress={addRow}>
              <Ionicons name="add" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          )}
        </View>
      ))}

      {rows.length === 0 && availableForNewRow.length > 0 && (
        <TouchableOpacity style={styles.emptyAddRow} onPress={addRow} activeOpacity={0.75}>
          <View style={styles.addBtn}>
            <Ionicons name="add" size={20} color="#FFFFFF" />
          </View>
          <Text style={styles.emptyAddLabel}>Add Reminder</Text>
        </TouchableOpacity>
      )}

      <SelectListDialog
        visible={editingIndex !== null}
        onDismiss={() => setEditingIndex(null)}
        title="Choose Reminder"
        options={optionsForEditing}
        value={editingIndex !== null ? values[editingIndex] : undefined}
        onSelect={(minutes) => {
          if (editingIndex === null) return;
          const next = [...values];
          if (editingIndex >= next.length) next.push(minutes as number);
          else next[editingIndex] = minutes as number;
          onChange(next);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  rowWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  badge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  label: { flex: 1, fontSize: 14.5, fontWeight: '600', color: colors.text },
  labelPlaceholder: { color: colors.textDisabled, fontWeight: '500' },
  removeBtn: { padding: 2 },
  addBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyAddRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  emptyAddLabel: { fontSize: 14.5, fontWeight: '600', color: colors.primary },
});
