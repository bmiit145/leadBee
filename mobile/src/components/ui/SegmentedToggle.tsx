import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, LayoutChangeEvent } from 'react-native';
import { colors, borderRadius } from '../../theme';

interface Props {
  leftLabel: string;
  rightLabel: string;
  /** true = right side selected. */
  value: boolean;
  onChange: (right: boolean) => void;
}

/**
 * The "My Task" / "Assign Task" control from the Task list: a solid-colour
 * track with a white pill that slides to whichever side is selected — an
 * iOS-style segmented control, distinct from FilterTabs (separate bordered
 * chips) and the Reminder screen's shared-track segmented tabs.
 */
export function SegmentedToggle({ leftLabel, rightLabel, value, onChange }: Props) {
  const [trackWidth, setTrackWidth] = useState(0);
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, { toValue: value ? 1 : 0, duration: 220, useNativeDriver: false }).start();
  }, [value, anim]);

  const onLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);

  return (
    <View style={styles.track} onLayout={onLayout}>
      {trackWidth > 0 && (
        <Animated.View
          style={[
            styles.thumb,
            {
              width: trackWidth / 2 - 6,
              transform: [{ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [0, trackWidth / 2] }) }],
            },
          ]}
        />
      )}
      <TouchableOpacity style={styles.half} onPress={() => onChange(false)} activeOpacity={0.8}>
        <Text style={[styles.label, !value && styles.labelActive]}>{leftLabel}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.half} onPress={() => onChange(true)} activeOpacity={0.8}>
        <Text style={[styles.label, value && styles.labelActive]}>{rightLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    height: 44,
    overflow: 'hidden',
  },
  thumb: {
    position: 'absolute',
    top: 3,
    left: 3,
    bottom: 3,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.full,
  },
  half: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  labelActive: { color: colors.primary },
});
