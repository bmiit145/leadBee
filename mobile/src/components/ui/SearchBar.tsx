import React from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '../../theme';

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  /** Renders the solid filter button beside the input when provided. */
  onFilterPress?: () => void;
}

/** Search input, optionally paired with the solid filter button. Every list
 *  screen uses this — the placeholder defaults to the app-wide wording. */
export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search by customer name or number',
  onFilterPress,
}: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.bar}>
        <Ionicons name="search" size={16} color={colors.primary} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textDisabled}
          style={styles.input}
          returnKeyType="search"
        />
        {value.length > 0 ? (
          <TouchableOpacity onPress={() => onChangeText('')} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={17} color={colors.textDisabled} />
          </TouchableOpacity>
        ) : null}
      </View>

      {onFilterPress ? (
        <TouchableOpacity style={styles.filterBtn} onPress={onFilterPress} accessibilityLabel="Filters">
          <Ionicons name="options" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  bar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  input: { flex: 1, fontSize: 13, color: colors.text, padding: 0 },
  filterBtn: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
