import React, { useState } from 'react';
import { View } from 'react-native';
import { FieldLabel, FormField } from '../ui/FormField';
import { CalendarPickerModal } from '../ui/CalendarPickerModal';

function fmt(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
}

interface SingleProps {
  label: string;
  required?: boolean;
  value: Date | null;
  onChange: (d: Date) => void;
  placeholder?: string;
  /** Dialog heading, e.g. "Select meeting date". */
  dialogTitle: string;
}

/** Labelled single-date field + its calendar dialog. */
export function DateField({
  label,
  required,
  value,
  onChange,
  placeholder = 'Select Date',
  dialogTitle,
}: SingleProps) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <FieldLabel required={required}>{label}</FieldLabel>
      <FormField
        icon="calendar"
        value={value ? fmt(value) : null}
        placeholder={placeholder}
        onPress={() => setOpen(true)}
      />
      <CalendarPickerModal
        visible={open}
        onDismiss={() => setOpen(false)}
        title={dialogTitle}
        mode="single"
        value={value}
        onApply={onChange}
      />
    </View>
  );
}

interface RangeProps {
  label: string;
  required?: boolean;
  value: { start: Date | null; end: Date | null };
  onChange: (v: { start: Date; end: Date }) => void;
  placeholder?: string;
  dialogTitle?: string;
}

/** Labelled start→end range field + its calendar dialog. */
export function DateRangeField({
  label,
  required,
  value,
  onChange,
  placeholder = 'Select date range',
  dialogTitle = 'Select date range',
}: RangeProps) {
  const [open, setOpen] = useState(false);
  const display =
    value.start && value.end ? `${fmt(value.start)} → ${fmt(value.end)}` : null;

  return (
    <View>
      <FieldLabel required={required}>{label}</FieldLabel>
      <FormField
        icon="calendar"
        value={display}
        placeholder={placeholder}
        onPress={() => setOpen(true)}
      />
      <CalendarPickerModal
        visible={open}
        onDismiss={() => setOpen(false)}
        title={dialogTitle}
        mode="range"
        value={value}
        onApply={onChange}
      />
    </View>
  );
}
