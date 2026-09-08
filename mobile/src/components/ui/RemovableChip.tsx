import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '../../theme';

interface Props {
  label: string;
  onRemove: () => void;
  /** Overrides the default primary fill (e.g. task label colours). */
  color?: string;
  /** `solid` = filled chip w/ white text; `tint` = pale fill w/ coloured text. */
  variant?: 'solid' | 'tint';
}

/** A selected value that can be taken back out — assigned members, task labels. */
export function RemovableChip({ label, onRemove, color = colors.primary, variant = 'solid' }: Props) {
  const solid = variant === 'solid';
  const fg = solid ? '#FFFFFF' : color;

  return (
    <View
      style={[
        styles.chip,
        solid
          ? { backgroundColor: color }
          : { backgroundColor: `${color}20`, borderWidth: 1, borderColor: color },
      ]}
    >
      <Text style={[styles.text, { color: fg }]} numberOfLines={1}>{label}</Text>
      <TouchableOpacity onPress={onRemove} accessibilityLabel={`Remove ${label}`} hitSlop={6}>
        <Ionicons name="close" size={15} color={fg} />
      </TouchableOpacity>
    </View>
  );
}

/** Wrapping row for a set of chips. */
export function ChipRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: borderRadius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: '100%',
  },
  text: { fontWeight: '700', fontSize: 13.5, flexShrink: 1 },
});
