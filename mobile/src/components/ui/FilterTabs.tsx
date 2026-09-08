import React from 'react';
import { ScrollView, TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { colors, spacing, borderRadius } from '../../theme';

export interface FilterTab<T extends string> {
  value: T;
  label: string;
  /** Rendered as `Label (04)` when present — matches how counts read in-app. */
  count?: number;
  /** Selected pill colour; falls back to the theme primary. */
  color?: string;
}

interface Props<T extends string> {
  tabs: FilterTab<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Zero-pad counts to two digits, as the reference app does. */
  padCounts?: boolean;
}

/**
 * Horizontally scrolling filter strip.
 *
 * The lead pipeline alone needs 12 of these, and tasks and meetings need their
 * own — so it takes a generic value type and each screen supplies its own tabs
 * rather than this knowing about any particular domain.
 */
export function FilterTabs<T extends string>({
  tabs,
  value,
  onChange,
  padCounts = true,
}: Props<T>) {
  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {tabs.map((tab) => {
          const active = tab.value === value;
          const accent = tab.color ?? colors.primary;
          const count =
            tab.count === undefined
              ? null
              : padCounts
                ? String(tab.count).padStart(2, '0')
                : String(tab.count);

          return (
            <TouchableOpacity
              key={tab.value}
              onPress={() => onChange(tab.value)}
              activeOpacity={0.75}
              style={[
                styles.tab,
                active
                  ? { backgroundColor: accent, borderColor: accent }
                  : { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[styles.label, { color: active ? '#FFFFFF' : colors.textSecondary }]}
                numberOfLines={1}
              >
                {tab.label}
                {count !== null ? ` (${count})` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 8,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
  },
});
