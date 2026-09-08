import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { borderRadius } from '../../theme';

export type ChipSize = 'sm' | 'md';

interface Props {
  label: string;
  /** Drives both text colour and the tinted background. */
  color: string;
  size?: ChipSize;
  /** Solid fill instead of a tint — for the selected state. */
  filled?: boolean;
  /** Leading coloured dot instead of a tinted background — the "● New" style
   *  used on lead stage chips specifically. */
  dot?: boolean;
  /** Leading Ionicon (e.g. the bell on a reminder chip). Ignored when `dot`. */
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
}

/**
 * The pill used for lead stage, task status and meeting status.
 *
 * Every status in the app is a coloured pill, so the tint maths lives here once
 * rather than being re-derived with `color + '1A'` at each call site.
 */
export function StatusChip({ label, color, size = 'sm', filled = false, dot = false, icon, style }: Props) {
  const dims = size === 'md' ? SIZES.md : SIZES.sm;
  const textColor = filled ? '#FFFFFF' : dot ? '#1F2933' : color;
  const showIcon = icon && !dot;

  return (
    <View
      style={[
        styles.chip,
        (dot || showIcon) && styles.dotChip,
        {
          paddingHorizontal: dims.padX,
          paddingVertical: dims.padY,
          backgroundColor: filled ? color : dot ? `${color}15` : `${color}1A`,
          borderColor: filled ? color : dot ? `${color}35` : `${color}50`,
        },
        style,
      ]}
    >
      {dot && <View style={[styles.dot, { backgroundColor: color }]} />}
      {showIcon && <Ionicons name={icon} size={dims.font} color={textColor} />}
      <Text style={[styles.text, { fontSize: dims.font, color: textColor }, dot && styles.dotText]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const SIZES = {
  sm: { padX: 9, padY: 3, font: 11 },
  md: { padX: 11, padY: 5, font: 12 },
};

const styles = StyleSheet.create({
  chip: {
    borderRadius: borderRadius.full,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  dotChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotText: { fontSize: 12, fontWeight: '700' },
  text: {
    fontWeight: '700',
  },
});
