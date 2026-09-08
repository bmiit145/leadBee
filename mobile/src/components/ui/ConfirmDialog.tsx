import React, { useEffect, useRef } from 'react';
import { Modal, View, Text, StyleSheet, Pressable, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '../../theme';

interface Props {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Badge glyph. Defaults to the trash can. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** `danger` = red confirm button (default); `primary` = the app primary. */
  tone?: 'danger' | 'primary';
  loading?: boolean;
}

/**
 * Centred confirm dialog with an animated icon badge — the reference app's
 * "Delete comment?" style. Use this for every destructive confirm instead of
 * `Alert.alert`, so the moment always looks the same. The badge pops in, the
 * glyph wiggles a few times and the sparkles twinkle.
 */
export function ConfirmDialog({
  visible,
  onCancel,
  onConfirm,
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  icon = 'trash',
  tone = 'danger',
  loading,
}: Props) {
  const pop = useRef(new Animated.Value(0)).current;
  const wiggle = useRef(new Animated.Value(0)).current;
  const twinkle = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      pop.setValue(0);
      wiggle.setValue(0);
      twinkle.setValue(0);
      return;
    }

    Animated.spring(pop, { toValue: 1, useNativeDriver: true, friction: 5, tension: 140 }).start();

    const wiggleLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(wiggle, { toValue: 1, duration: 90, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue: -1, duration: 180, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue: 0, duration: 90, easing: Easing.linear, useNativeDriver: true }),
        Animated.delay(1600),
      ]),
    );
    const twinkleLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(twinkle, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(twinkle, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    wiggleLoop.start();
    twinkleLoop.start();
    return () => {
      wiggleLoop.stop();
      twinkleLoop.stop();
    };
  }, [visible, pop, wiggle, twinkle]);

  const rotate = wiggle.interpolate({ inputRange: [-1, 1], outputRange: ['-12deg', '12deg'] });
  const sparkleStyle = {
    opacity: twinkle.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
    transform: [{ scale: twinkle.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.15] }) }],
  };
  const confirmColor = tone === 'danger' ? colors.error : colors.primary;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.badge}>
            <Animated.View style={[styles.spark, styles.sparkTL, sparkleStyle]}>
              <Ionicons name="sparkles" size={12} color={colors.info} />
            </Animated.View>
            <Animated.View style={[styles.spark, styles.sparkTR, sparkleStyle]}>
              <Ionicons name="sparkles" size={9} color={colors.info} />
            </Animated.View>
            <Animated.View style={[styles.spark, styles.sparkBL, sparkleStyle]}>
              <Ionicons name="sparkles" size={8} color={colors.info} />
            </Animated.View>
            <Animated.View style={{ transform: [{ scale: pop }, { rotate }] }}>
              <Ionicons name={icon} size={34} color={colors.info} />
            </Animated.View>
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <View style={styles.actions}>
            <Pressable style={[styles.btn, styles.cancelBtn]} onPress={onCancel} disabled={loading}>
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, { backgroundColor: confirmColor }, loading && styles.btnOff]}
              onPress={onConfirm}
              disabled={loading}
            >
              <Text style={styles.confirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xxl,
    padding: spacing.lg,
    alignItems: 'center',
  },
  badge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: `${colors.info}14`,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  spark: { position: 'absolute' },
  sparkTL: { top: 16, left: 18 },
  sparkTR: { top: 12, right: 20 },
  sparkBL: { bottom: 20, left: 26 },
  title: { fontSize: 19, fontWeight: '800', color: colors.text, textAlign: 'center' },
  message: {
    fontSize: 13.5,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  actions: { flexDirection: 'row', gap: spacing.sm, alignSelf: 'stretch' },
  btn: {
    flex: 1,
    borderRadius: borderRadius.full,
    paddingVertical: 13,
    alignItems: 'center',
  },
  btnOff: { opacity: 0.6 },
  cancelBtn: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.primary },
  cancelText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  confirmText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});
