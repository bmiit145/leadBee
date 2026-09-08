import React from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { FieldLabel } from '../ui/FormField';
import { colors, spacing, borderRadius } from '../../theme';

interface Props {
  label: string;
  required?: boolean;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
}

/** Labelled free-text input (task subject, description). */
export function TextField({
  label,
  required,
  value,
  onChangeText,
  placeholder,
  multiline = false,
}: Props) {
  return (
    <View>
      <FieldLabel required={required}>{label}</FieldLabel>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textDisabled}
        style={[styles.input, multiline && styles.multiline]}
        multiline={multiline}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
});
