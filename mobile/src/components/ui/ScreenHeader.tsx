import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '../../theme';
import { PopupMenu, type PopupMenuItem } from './PopupMenu';

export interface HeaderAction {
  icon: string;
  onPress: () => void;
  accessibilityLabel: string;
}

interface Props {
  title: string;
  /** Left affordance. `back` pops the stack, `menu` opens a drawer. */
  leading?: 'back' | 'menu' | 'none';
  onLeadingPress?: () => void;
  actions?: HeaderAction[];
  /**
   * Less-used actions, behind a ⋮ button at the end of the bar. Keeps the bar to
   * the actions people reach for every time.
   */
  menuItems?: PopupMenuItem[];
  /** Rendered flush under the title inside the primary band (e.g. Reminder's tabs). */
  children?: React.ReactNode;
}

/**
 * The primary-coloured top bar on every pushed screen.
 *
 * Previously each screen re-declared its own header markup and styles (11
 * copies of the same title style alone), so titles and icon buttons drifted
 * apart. Screens now pass content, never layout.
 */
export function ScreenHeader({
  title,
  leading = 'back',
  onLeadingPress,
  actions = [],
  menuItems = [],
  children,
}: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const menuButton = useRef<View>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number } | null>(null);

  // Measured on each open, so the menu lands on the button wherever the bar is.
  const openMenu = () => {
    menuButton.current?.measureInWindow((x, y, width) => {
      setMenuAnchor({ top: y + 4, right: Math.max(8, Dimensions.get('window').width - (x + width) + 4) });
    });
  };

  const hasTrailing = actions.length > 0 || menuItems.length > 0;

  const leadingIcon = leading === 'menu' ? 'menu' : 'chevron-back';
  const handleLeading = onLeadingPress ?? (() => router.back());

  return (
    <View style={[styles.bar, { paddingTop: insets.top + 10 }]}>
      <View style={styles.row}>
        {leading === 'none' ? (
          <View style={styles.btn} />
        ) : (
          <TouchableOpacity
            style={styles.btn}
            onPress={handleLeading}
            accessibilityRole="button"
            accessibilityLabel={leading === 'menu' ? 'Open menu' : 'Go back'}
          >
            <Ionicons name={leadingIcon as any} size={leading === 'menu' ? 24 : 22} color="#FFFFFF" />
          </TouchableOpacity>
        )}

        <Text style={styles.title} numberOfLines={1}>{title}</Text>

        {/* Keeps the title optically centred when there are no actions. */}
        {!hasTrailing ? (
          <View style={styles.btn} />
        ) : (
          <View style={styles.actions}>
            {actions.map((a) => (
              <TouchableOpacity
                key={a.accessibilityLabel}
                style={styles.btn}
                onPress={a.onPress}
                accessibilityRole="button"
                accessibilityLabel={a.accessibilityLabel}
              >
                <Ionicons name={a.icon as any} size={23} color="#FFFFFF" />
              </TouchableOpacity>
            ))}
            {menuItems.length > 0 ? (
              <TouchableOpacity
                ref={menuButton}
                style={styles.btn}
                onPress={openMenu}
                accessibilityRole="button"
                accessibilityLabel={t('common.moreOptions')}
              >
                <Ionicons name="ellipsis-vertical" size={21} color="#FFFFFF" />
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </View>

      {children}

      {menuAnchor ? (
        <PopupMenu
          visible
          onDismiss={() => setMenuAnchor(null)}
          items={menuItems}
          anchor={menuAnchor}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.primary, paddingBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  btn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 19, fontWeight: '700', color: '#FFFFFF', textAlign: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center' },
});
