import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { colors, borderRadius } from '../../theme';

export interface SegmentedTab<T extends string> {
  value: T;
  label: string;
  count?: number;
}

interface Props<T extends string> {
  tabs: SegmentedTab<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Zero-pad counts to two digits, as the reference app does. */
  padCounts?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Segmented tabs on one shared pale track, with the active segment filled.
 *
 * Distinct from FilterTabs (separate bordered chips, scrollable) and
 * SegmentedToggle (two-option sliding switch). Used by the Reminder screen and
 * Home's "Today's Reminder" — both previously had their own copy.
 */
export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  padCounts = true,
  style,
}: Props<T>) {
  return (
    <View style={[styles.track, style]}>
      {tabs.map((tab) => {
        const active = tab.value === value;
        const count =
          tab.count === undefined
            ? null
            : padCounts
              ? String(tab.count).padStart(2, '0')
              : String(tab.count);

        return (
          <TouchableOpacity
            key={tab.value}
            style={[styles.pill, active && styles.pillActive]}
            onPress={() => onChange(tab.value)}
            activeOpacity={0.8}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.text, active && styles.textActive]} numberOfLines={1}>
              {tab.label}
              {count !== null ? ` (${count})` : ''}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: `${colors.primary}14`,
    borderRadius: borderRadius.full,
    padding: 3,
  },
  pill: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: borderRadius.full },
  pillActive: { backgroundColor: colors.primary },
  text: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
  textActive: { color: '#FFFFFF' },
});
