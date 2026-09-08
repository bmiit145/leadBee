import React from 'react';
import { View } from 'react-native';
import { FieldLabel } from '../ui/FormField';
import { MultiReminderPicker } from '../ui/MultiReminderPicker';

interface Props {
  values: number[];
  onChange: (values: number[]) => void;
  label?: string;
}

/**
 * "Set Reminder" — the numbered, repeatable reminder list.
 *
 * Reminders are ALWAYS multi-value in this app: the data model stores
 * `reminderMinutesBefore` as `number[]` on both Lead and Meeting, and the
 * reference app lets you stack several. Use this field anywhere a reminder is
 * set; never wire a single-select dialog to a reminder, or Meeting and Lead
 * drift apart (which is exactly what happened before this component existed).
 */
export function ReminderField({ values, onChange, label = 'Set Reminder' }: Props) {
  return (
    <View>
      <FieldLabel>{label}</FieldLabel>
      <MultiReminderPicker values={values} onChange={onChange} />
    </View>
  );
}
