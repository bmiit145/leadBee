import React, { useEffect, useRef } from 'react';
import {
  Modal,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Easing,
  AccessibilityInfo,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '../../theme';

export interface PopupMenuItem {
  label: string;
  onPress: () => void;
  /** Red text, for the one destructive row a menu may carry. */
  destructive?: boolean;
}

interface Props {
  visible: boolean;
  onDismiss: () => void;
  items: PopupMenuItem[];
  /** Window coordinates of the menu's top-right corner — the ⋮ button it opens from. */
  anchor: { top: number; right: number };
}

/**
 * The overflow menu that drops from a ⋮ button, as WhatsApp's does: a plain
 * card of text rows over the screen, growing out of the corner it was opened
 * from. Tapping outside, or picking a row, closes it.
 *
 * Built on Modal rather than a native menu so it ships over the air — a native
 * menu module would need a new app build (MOB-19).
 */
export function PopupMenu({ visible, onDismiss, items, anchor }: Props) {
  const { t } = useTranslation();
  const grow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      grow.setValue(0);
      return;
    }
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled) return;
        if (reduce) {
          grow.setValue(1);
          return;
        }
        Animated.timing(grow, {
          toValue: 1,
          duration: 150,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      });
    return () => {
      cancelled = true;
    };
  }, [visible, grow]);

  // Scaling about the top-right corner: RN scales about the centre, so the card
  // is shifted by half its growth to keep that corner pinned under the finger.
  const scale = grow.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });
  const shiftX = grow.interpolate({ inputRange: [0, 1], outputRange: [MENU_WIDTH * 0.075, 0] });
  const shiftY = grow.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] });

  const pick = (item: PopupMenuItem) => {
    onDismiss();
    // After the modal has closed, so a screen the item opens is not covered by it.
    requestAnimationFrame(item.onPress);
  };

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={onDismiss}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityLabel={t('common.closeMenu')} />
      <Animated.View
        style={[
          styles.card,
          {
            top: anchor.top,
            right: anchor.right,
            opacity: grow,
            transform: [{ translateX: shiftX }, { translateY: shiftY }, { scale }],
          },
        ]}
        accessibilityRole="menu"
      >
        {items.map((item) => (
          <Pressable
            key={item.label}
            onPress={() => pick(item)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            android_ripple={{ color: '#00000014' }}
            accessibilityRole="menuitem"
          >
            <Text style={[styles.label, item.destructive && styles.destructive]} numberOfLines={1}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </Animated.View>
    </Modal>
  );
}

const MENU_WIDTH = 200;

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    minWidth: MENU_WIDTH,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 12,
  },
  row: { paddingHorizontal: 20, paddingVertical: 14 },
  rowPressed: { backgroundColor: '#0000000A' },
  label: { fontSize: 16, color: colors.text },
  destructive: { color: colors.error },
});
