import React from 'react';
import { Text, TouchableOpacity, ActivityIndicator, StyleSheet, View, StyleProp, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius } from '../../theme';

interface Props {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The full-width form CTA. Disabled state is the reference app's muted navy
 * (not a faded primary), which is why it needs to live in one place — it was
 * previously re-declared in eight screens and had already drifted.
 */
export function PrimaryButton({ label, onPress, disabled, loading, style }: Props) {
  const off = disabled || loading;
  return (
    <TouchableOpacity
      style={[styles.btn, off && styles.btnDisabled, style]}
      onPress={onPress}
      disabled={off}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off }}
    >
      {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.text}>{label}</Text>}
    </TouchableOpacity>
  );
}

/** Sticky footer that keeps the CTA above the gesture bar on long forms. */
export function StickyFooter({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.footer, { paddingBottom: Math.max(spacing.md, insets.bottom + spacing.sm) }]}>
      {children}
    </View>
  );
}

/** Bottom padding a scroll view needs so content clears the sticky footer. */
export const STICKY_FOOTER_SPACE = 110;

const styles = StyleSheet.create({
  btn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnDisabled: { backgroundColor: '#1E3A5F' },
  text: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
