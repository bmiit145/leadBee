/**
 * ServerDownScreen — Premium animated error state for backend maintenance or outages
 *
 * Design:
 *  - Clean surface card on a soft professional backdrop
 *  - Animated cloud-off icon with gentle floating motion
 *  - Status-aware messaging (API Down vs. Database Maintenance)
 *  - Primary retry action with tactile feedback
 */

import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Dimensions,
} from 'react-native';
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
import { ServerStatus } from '../services/system.service';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// ─── Cloud Off SVG Icon (Pure RN composition) ──────────────────────────────
function CloudOffIcon({ size = 72 }: { size?: number }) {
  const strokeColor = colors.primaryDark;
  const s = size / 72; // scale factor

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Cloud main body arcs */}
      <View
        style={{
          width: size * 0.5,
          height: size * 0.5,
          borderRadius: size * 0.25,
          borderWidth: 5 * s,
          borderColor: strokeColor,
          position: 'absolute',
          bottom: size * 0.1,
          left: size * 0.05,
        }}
      />
      <View
        style={{
          width: size * 0.6,
          height: size * 0.6,
          borderRadius: size * 0.3,
          borderWidth: 5 * s,
          borderColor: strokeColor,
          position: 'absolute',
          top: size * 0.1,
          right: size * 0.05,
        }}
      />
      {/* Strike-through */}
      <View
        style={{
          position: 'absolute',
          width: 5 * s,
          height: size * 1.1,
          backgroundColor: colors.error,
          borderRadius: 3 * s,
          transform: [{ rotate: '-45deg' }],
          opacity: 0.8,
        }}
      />
    </View>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────
interface Props {
  status: ServerStatus;
  onRetry: () => void;
  isChecking: boolean;
}

export function ServerDownScreen({ status, onRetry, isChecking }: Props) {
  const { t } = useTranslation();
  // ─── Entrance Animation ──────────────────────────────────────────────────
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(40);

  // ─── Floating Motion for Icon ───────────────────────────────────────────
  const floatY = useSharedValue(0);

  // ─── Button Scale ────────────────────────────────────────────────────────
  const btnScale = useSharedValue(1);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 500 });
    translateY.value = withSpring(0, { damping: 15 });

    floatY.value = withRepeat(
      withSequence(
        withTiming(-12, { duration: 2500, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 2500, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
  }, []);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: floatY.value }],
  }));

  const btnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: btnScale.value }],
  }));

  // Helper to determine messaging
  const getContent = () => {
    switch (status) {
      case 'database_down':
        return {
          title: t('server.databaseTitle'),
          body: t('server.databaseBody'),
          iconColor: '#FEF3C7', // Amber container
        };
      case 'unreachable':
      default:
        return {
          title: t('server.connectionTitle'),
          body: t('server.connectionBody'),
          iconColor: '#FEE2E2', // Red container
        };
    }
  };

  const { title, body, iconColor } = getContent();

  return (
    <View style={styles.backdrop}>
      <Animated.View style={[styles.card, containerStyle]}>
        {/* ── Icon ── */}
        <Animated.View style={[styles.iconWrap, iconStyle, { backgroundColor: iconColor }]}>
          <CloudOffIcon size={72} />
        </Animated.View>

        {/* ── Content ── */}
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>

        {/* ── Action ── */}
        <Animated.View style={btnStyle}>
          <Pressable
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
              isChecking && styles.buttonDisabled,
            ]}
            onPressIn={() => (btnScale.value = withSpring(0.96))}
            onPressOut={() => (btnScale.value = withSpring(1))}
            onPress={onRetry}
            disabled={isChecking}
          >
            <Text style={styles.buttonLabel}>
              {isChecking ? t('server.checkingSystem') : t('common.tryAgain')}
            </Text>
          </Pressable>
        </Animated.View>

        <Text style={styles.footer}>{t('server.status')}: {status.replace('_', ' ')}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    zIndex: 99999,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.surface,
    padding: spacing.xxl,
    borderRadius: borderRadius.xxl,
    alignItems: 'center',
    ...shadows.lg,
  },
  iconWrap: {
    padding: spacing.xl,
    borderRadius: borderRadius.full,
    marginBottom: spacing.xl,
  },
  title: {
    ...typography.h2,
    textAlign: 'center',
    marginBottom: spacing.sm,
    color: colors.text,
  },
  body: {
    ...typography.body,
    textAlign: 'center',
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.xxl,
  },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: spacing.xxl,
    borderRadius: borderRadius.full,
    minWidth: 200,
    alignItems: 'center',
    ...shadows.md,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonDisabled: {
    backgroundColor: colors.textTertiary,
  },
  buttonLabel: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 16,
  },
  footer: {
    marginTop: spacing.xl,
    fontSize: 12,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});
