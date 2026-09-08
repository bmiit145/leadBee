import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { colors, spacing, borderRadius } from '../../theme';

interface Props {
  /** Bold label rendered inside the tinted container. */
  label?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** The pale-primary grouping box used for optional sections (Meeting Assign,
 *  Meeting Purpose, Add Checklist/Label/Images/Comments). */
export function SectionBox({ label, children, style }: Props) {
  return (
    <View style={[styles.box, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: `${colors.primary}0D`,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 },
});
