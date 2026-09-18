import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, AccessibilityInfo } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';

interface Props {
  /** Which way the next tap will move things. */
  direction: 'up' | 'down';
  size?: number;
  color?: string;
}

/**
 * A double chevron that keeps quietly pointing the way: the first arrow fades
 * in, a second stacks behind it, both drift a little in their direction and
 * fade, then it rests and repeats. It marks a control that has no label — a
 * fold, a drawer — without shouting.
 *
 * Runs on the native driver (opacity and translate only), and stands still for
 * anyone who has asked the system to reduce motion.
 */
export function AnimatedChevrons({ direction, size = 14, color = colors.textSecondary }: Props) {
  const first = useRef(new Animated.Value(0)).current;
  const second = useRef(new Animated.Value(0)).current;
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;

    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) {
        // Still: both arrows shown, nothing moving.
        first.setValue(1);
        second.setValue(1);
        return;
      }
      const fade = (value: Animated.Value, to: number, duration: number) =>
        Animated.timing(value, { toValue: to, duration, easing: Easing.out(Easing.quad), useNativeDriver: true });

      loop = Animated.loop(
        Animated.sequence([
          fade(first, 1, 280),
          Animated.parallel([fade(second, 1, 280), fade(drift, 1, 560)]),
          Animated.delay(260),
          Animated.parallel([fade(first, 0, 320), fade(second, 0, 320)]),
          Animated.timing(drift, { toValue: 0, duration: 0, useNativeDriver: true }),
          Animated.delay(700),
        ])
      );
      loop.start();
    });

    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [first, second, drift]);

  const name = direction === 'up' ? 'chevron-up' : 'chevron-down';
  const sign = direction === 'up' ? -1 : 1;
  // The two arrows overlap by most of their height, so they read as one ">>".
  const offset = size * 0.45;

  const move = drift.interpolate({ inputRange: [0, 1], outputRange: [0, 2.5 * sign] });

  return (
    <View style={{ width: size, height: size + offset }} importantForAccessibility="no-hide-descendants">
      <Animated.View
        style={[
          styles.arrow,
          { top: direction === 'up' ? offset : 0, opacity: first, transform: [{ translateY: move }] },
        ]}
      >
        <Ionicons name={name} size={size} color={color} />
      </Animated.View>
      <Animated.View
        style={[
          styles.arrow,
          { top: direction === 'up' ? 0 : offset, opacity: second, transform: [{ translateY: move }] },
        ]}
      >
        <Ionicons name={name} size={size} color={color} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  arrow: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
});
