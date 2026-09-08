/**
 * NoInternetScreen — Premium animated offline screen
 *
 * Design:
 *  - Clean white card on a soft background
 *  - Animated wifi-off icon with gentle pulse
 *  - Smooth entrance (fade + slide up)
 *  - Minimal typography matching app design system
 *  - Primary-colored retry button
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { colors, spacing, borderRadius, shadows, typography } from '../theme';

function WifiOffIcon() {
  return (
    <View style={styles.iconCircle}>
      <Text style={styles.iconText}>Wi-Fi</Text>
    </View>
  );
}

interface Props {
  onRetry: () => void;
  isChecking: boolean;
}

export function NoInternetScreen({ onRetry, isChecking }: Props) {
  const { t } = useTranslation();
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(40);
  const iconScale = useSharedValue(1);
  const btnScale = useSharedValue(1);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 350, easing: Easing.out(Easing.quad) });
    translateY.value = withSpring(0, { damping: 18, stiffness: 120 });
    iconScale.value = withRepeat(
      withSequence(
        withTiming(1.05, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
  }, [iconScale, opacity, translateY]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
  }));

  const buttonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: btnScale.value }],
  }));

  return (
    <View style={styles.backdrop}>
      <Animated.View style={[styles.card, containerStyle]}>
        <Animated.View style={iconStyle}>
          <WifiOffIcon />
        </Animated.View>

        <Text style={styles.title}>{t('network.noInternetTitle')}</Text>
        <Text style={styles.body}>{t('network.noInternetBody')}</Text>

        <Animated.View style={buttonStyle}>
          <Pressable
            style={({ pressed }) => [styles.button, pressed ? styles.buttonPressed : null]}
            onPressIn={() => {
              btnScale.value = withSpring(0.97, { damping: 14 });
            }}
            onPressOut={() => {
              btnScale.value = withSpring(1, { damping: 14 });
            }}
            onPress={onRetry}
            disabled={isChecking}
          >
            <Text style={styles.buttonLabel}>{isChecking ? t('common.checking') : t('common.tryAgain')}</Text>
          </Pressable>
        </Animated.View>

        <Text style={styles.hint}>{t('network.reconnectHint')}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    zIndex: 9999,
    elevation: 20,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xxl,
    padding: spacing.xxl,
    alignItems: 'center',
    ...shadows.lg,
  },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  iconText: {
    color: colors.primary,
    fontWeight: '800',
    fontSize: 16,
  },
  title: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  button: {
    minWidth: 160,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    ...shadows.md,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonLabel: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 15,
  },
  hint: {
    marginTop: spacing.md,
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
        {/* ── Icon ─────────────────────────────────────────────────────── */}
