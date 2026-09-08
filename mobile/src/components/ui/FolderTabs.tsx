import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, borderRadius } from '../../theme';

export interface FolderTab<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  tabs: FolderTab<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * "Notebook tab" row that sits inside the primary header band — the active
 * tab is a white tab whose background merges into the content area below it.
 * Used for Reminder's Today / Tomorrow / Overdue.
 */
export function FolderTabs<T extends string>({ tabs, value, onChange }: Props<T>) {
  return (
    <View style={styles.row}>
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <TouchableOpacity
            key={tab.value}
            style={[styles.tab, active && styles.tabActive]}
            onPress={() => onChange(tab.value)}
            activeOpacity={0.8}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.text, active && styles.textActive]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingHorizontal: spacing.sm },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
  },
  tabActive: { backgroundColor: colors.background },
  text: { fontSize: 14.5, fontWeight: '700', color: '#FFFFFF' },
  textActive: { color: colors.primary },
});
