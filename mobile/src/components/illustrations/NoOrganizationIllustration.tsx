import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';

const INK = '#18181B';
const WINDOW = '#E4E4E7';
/** The bee in LeadBee — the one warm colour on an otherwise monochrome screen. */
const HONEY = '#F59E0B';

const STAGE = 240;
const BUILDING_W = 120;
const BUILDING_H = 132;
const BUILDING_LEFT = (STAGE - BUILDING_W) / 2;
const BUILDING_TOP = 48;

/**
 * Honours the system "reduce motion" setting. Motion here is decoration, so
 * anyone who has asked for less gets a still picture with nothing missing.
 */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => mounted && setReduce(value))
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  return reduce;
}

/** 0 → 1 → 0, eased, forever. Native driver only: transforms and opacity. */
function useOscillation(duration: number, enabled: boolean, delay = 0): Animated.Value {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!enabled) {
      value.setValue(0);
      return;
    }
    const half = { duration: duration / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true };
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(value, { toValue: 1, ...half }),
        Animated.timing(value, { toValue: 0, ...half }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [value, duration, enabled, delay]);
  return value;
}

function useSpin(duration: number, enabled: boolean): Animated.Value {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!enabled) return;
    const loop = Animated.loop(
      Animated.timing(value, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [value, duration, enabled]);
  return value;
}

const float = (value: Animated.Value, distance: number) => ({
  transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, -distance] }) }],
});

/**
 * An organization building with people drifting around it, waiting to be let
 * in: the empty state for someone signed in who belongs to no organization.
 *
 * Drawn with react-native-svg and moved with the core Animated API on the
 * native driver, so it costs no JS frames and needs no extra dependency.
 */
export function NoOrganizationIllustration({ accessibilityLabel }: { accessibilityLabel: string }) {
  const animate = !useReduceMotion();

  const halo = useOscillation(4200, animate);
  const bob = useOscillation(3200, animate);
  const personA = useOscillation(2800, animate);
  const personB = useOscillation(3400, animate, 400);
  const personC = useOscillation(3000, animate, 800);
  const plus = useOscillation(1800, animate, 200);
  const light = useOscillation(2400, animate, 600);
  const orbit = useSpin(24000, animate);

  return (
    <View
      style={styles.stage}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      {/* Soft halo, breathing. */}
      <Animated.View
        style={[
          styles.halo,
          {
            opacity: halo.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }),
            transform: [{ scale: halo.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.04] }) }],
          },
        ]}
      />

      {/* Dotted orbit, turning slowly, carrying two small honey dots. */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            transform: [
              { rotate: orbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
            ],
          },
        ]}
      >
        <Svg width={STAGE} height={STAGE}>
          <Circle
            cx={STAGE / 2}
            cy={STAGE / 2}
            r={108}
            stroke="#D4D4D8"
            strokeWidth={1.5}
            strokeDasharray="3 9"
            strokeLinecap="round"
            fill="none"
          />
          <Circle cx={STAGE / 2} cy={12} r={4} fill={HONEY} />
          <Circle cx={STAGE / 2 - 76} cy={STAGE / 2 + 76} r={3} fill={INK} />
        </Svg>
      </Animated.View>

      {/* Ground shadow — shrinks as the building rises. */}
      <Animated.View
        style={[
          styles.shadow,
          {
            transform: [{ scaleX: bob.interpolate({ inputRange: [0, 1], outputRange: [1, 0.86] }) }],
            opacity: bob.interpolate({ inputRange: [0, 1], outputRange: [1, 0.7] }),
          },
        ]}
      >
        <Svg width={110} height={14}>
          <Ellipse cx={55} cy={7} rx={55} ry={7} fill="#E4E4E7" />
        </Svg>
      </Animated.View>

      {/* The organization. */}
      <Animated.View style={[styles.building, float(bob, 6)]}>
        <Svg width={BUILDING_W} height={BUILDING_H}>
          {/* Flag */}
          <Path d="M60 26 V6" stroke={INK} strokeWidth={3} strokeLinecap="round" />
          <Path d="M60 6 H80 L75 12 L80 18 H60 Z" fill={HONEY} />
          {/* Body */}
          <Rect x={16} y={26} width={88} height={104} rx={10} fill="#FFFFFF" stroke={INK} strokeWidth={3} />
          <Rect x={16} y={26} width={88} height={18} rx={9} fill={INK} />
          <Rect x={16} y={36} width={88} height={8} fill={INK} />
          {/* Windows */}
          {[54, 76].map((y) =>
            [28, 53, 78].map((x) => (
              <Rect key={`${x}-${y}`} x={x} y={y} width={14} height={12} rx={2.5} fill={WINDOW} />
            ))
          )}
          {/* Door */}
          <Rect x={49} y={100} width={22} height={30} rx={4} fill={INK} />
          <Circle cx={66} cy={116} r={1.8} fill="#FFFFFF" />
        </Svg>

        {/* One window with the light on — someone is home. Positioned in the
            SVG's own coordinates, so it moves with the building. */}
        <Animated.View
          style={[
            styles.litWindow,
            { opacity: light.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) },
          ]}
        />

        {/* "Create" — a plus that pulses at the building's corner. */}
        <Animated.View
          style={[
            styles.plusBadge,
            { transform: [{ scale: plus.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }) }] },
          ]}
        >
          <Ionicons name="add" size={18} color="#FFFFFF" />
        </Animated.View>
      </Animated.View>

      {/* People, waiting to join. */}
      <Animated.View style={[styles.person, styles.personA, float(personA, 8)]}>
        <Ionicons name="person" size={18} color={INK} />
      </Animated.View>
      <Animated.View style={[styles.person, styles.personB, float(personB, 10)]}>
        <Ionicons name="person" size={16} color={colors.textSecondary} />
      </Animated.View>
      <Animated.View style={[styles.person, styles.personC, styles.personHoney, float(personC, 7)]}>
        <Ionicons name="enter-outline" size={16} color={INK} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    width: STAGE,
    height: STAGE,
    alignSelf: 'center',
  },
  halo: {
    position: 'absolute',
    left: 30,
    top: 30,
    width: STAGE - 60,
    height: STAGE - 60,
    borderRadius: (STAGE - 60) / 2,
    backgroundColor: colors.surfaceVariant,
  },
  shadow: {
    position: 'absolute',
    left: (STAGE - 110) / 2,
    top: BUILDING_TOP + BUILDING_H - 4,
  },
  building: {
    position: 'absolute',
    left: BUILDING_LEFT,
    top: BUILDING_TOP,
    width: BUILDING_W,
    height: BUILDING_H,
  },
  litWindow: {
    position: 'absolute',
    left: 78,
    top: 54,
    width: 14,
    height: 12,
    borderRadius: 2.5,
    backgroundColor: HONEY,
  },
  plusBadge: {
    position: 'absolute',
    right: -6,
    top: 16,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: INK,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  person: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E4E4E7',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  personA: { left: 14, top: 62 },
  personB: { right: 12, top: 104, width: 36, height: 36, borderRadius: 18 },
  personC: { left: 34, top: 168, width: 36, height: 36, borderRadius: 18 },
  personHoney: { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' },
});
