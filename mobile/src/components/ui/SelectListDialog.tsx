import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '../../theme';
import { CenterDialog } from './CenterDialog';

export interface SelectOption<T extends string | number | null> {
  value: T;
  label: string;
  icon?: string;
}

interface Props<T extends string | number | null> {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  options: SelectOption<T>[];
  value: T | undefined;
  onSelect: (value: T) => void;
}

/**
 * Single-select radio list: Select Meeting Type, Choose Reminder, lead Status.
 * Selected row gets a primary-coloured border + text + a filled checkmark
 * circle; unselected rows are a plain light-grey pill — matches the reference
 * app's "Choose Reminder" / "Select Meeting Type" dialogs exactly.
 */
export function SelectListDialog<T extends string | number | null>({
  visible,
  onDismiss,
  title,
  options,
  value,
  onSelect,
}: Props<T>) {
  return (
    <CenterDialog visible={visible} onDismiss={onDismiss} title={title}>
      <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <TouchableOpacity
              key={String(opt.value)}
              style={[styles.row, selected && styles.rowSelected]}
              onPress={() => {
                onSelect(opt.value);
                onDismiss();
              }}
              activeOpacity={0.75}
            >
              {opt.icon ? (
                <Ionicons
                  name={opt.icon as any}
                  size={18}
                  color={selected ? colors.primary : colors.textSecondary}
                />
              ) : null}
              <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
                {opt.label}
              </Text>
              {selected ? (
                <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
              ) : (
                <View style={styles.radioEmpty} />
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </CenterDialog>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: 'transparent',
    borderRadius: borderRadius.lg,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    marginBottom: 8,
  },
  rowSelected: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}0F`,
  },
  label: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  labelSelected: {
    color: colors.primary,
    fontWeight: '700',
  },
  radioEmpty: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
});
