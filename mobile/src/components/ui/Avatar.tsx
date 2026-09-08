import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';

interface Props {
  /** When given (and no `icon`), renders up to two initials from the name. */
  name?: string;
  /** Ionicon name; takes precedence over initials. */
  icon?: string;
  size?: number;
  /** `tint` = pale primary circle with primary content (cards);
   *  `solid` = filled primary circle with white content (pickers, comments). */
  variant?: 'tint' | 'solid';
  style?: StyleProp<ViewStyle>;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/**
 * The circular identity badge used on every card, picker row and comment.
 * Centralised so the icon-vs-initials choice and the tint/solid treatment stay
 * identical everywhere instead of being re-styled per screen.
 */
export function Avatar({ name, icon, size = 40, variant = 'tint', style }: Props) {
  const solid = variant === 'solid';
  const fg = solid ? '#FFFFFF' : colors.primary;

  return (
    <View
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: solid ? colors.primary : `${colors.primary}14`,
        },
        style,
      ]}
    >
      {icon || !name ? (
        <Ionicons name={(icon ?? 'person') as any} size={size * 0.5} color={fg} />
      ) : (
        <Text style={[styles.text, { fontSize: size * 0.36, color: fg }]}>{initialsOf(name)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  text: { fontWeight: '800' },
});
