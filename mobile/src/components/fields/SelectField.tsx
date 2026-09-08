import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { FieldLabel, FormField } from '../ui/FormField';
import { SelectListDialog, SelectOption } from '../ui/SelectListDialog';

interface Props<T extends string> {
  label: string;
  required?: boolean;
  icon?: string;
  placeholder: string;
  /** Dialog heading; defaults to the field label. */
  dialogTitle?: string;
  options: SelectOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** Shows a colour dot in place of the icon (task/lead status fields). */
  dotColor?: string;
}

/** Labelled single-select field + its dialog. */
export function SelectField<T extends string>({
  label,
  required,
  icon,
  placeholder,
  dialogTitle,
  options,
  value,
  onChange,
  dotColor,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <View>
      <FieldLabel required={required}>{label}</FieldLabel>
      <FormField
        icon={icon}
        leading={dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : undefined}
        value={selected?.label ?? null}
        placeholder={placeholder}
        onPress={() => setOpen(true)}
      />
      <SelectListDialog
        visible={open}
        onDismiss={() => setOpen(false)}
        title={dialogTitle ?? label}
        options={options}
        value={value ?? undefined}
        onSelect={onChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { width: 13, height: 13, borderRadius: 6.5 },
});
