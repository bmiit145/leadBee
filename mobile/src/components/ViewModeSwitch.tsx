import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth, ViewMode } from '../stores/auth.store';
import { CenterDialog } from './ui/CenterDialog';
import type { HeaderAction } from './ui/ScreenHeader';
import { colors, spacing, borderRadius } from '../theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/** Top-bar glyph for the switch, shared so every screen shows the same one. */
export const VIEW_SWITCH_ICON: IoniconName = 'swap-horizontal';

const OPTIONS: { mode: ViewMode; icon: IoniconName; labelKey: string }[] = [
  { mode: 'admin', icon: 'business', labelKey: 'viewSwitch.organizer' },
  { mode: 'agent', icon: 'person', labelKey: 'viewSwitch.agent' },
];

/**
 * The "Switch Profile" control: a top-bar button that opens a dialog listing
 * both views, with the current one ticked.
 *
 * Organizers only. An agent has a single view and nothing to switch to, so the
 * control is absent rather than offering one option — the same rule the store
 * applies by pinning a non-organizer's `viewMode` to 'agent'.
 *
 * Switching changes what the app *shows*, never what the user may *do*: every
 * request is still authorised server-side on the account's real role (MOB-2).
 */
export function useViewModeSwitch() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isOrganizer, viewMode, switchViewMode } = useAuth();
  const [visible, setVisible] = useState(false);

  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);

  const choose = useCallback(
    (mode: ViewMode) => {
      setVisible(false);
      if (mode === viewMode) return;
      switchViewMode();
      // The two views differ on the home dashboard, so land there to show it.
      router.navigate('/(leads)');
    },
    [viewMode, switchViewMode, router]
  );

  const headerAction: HeaderAction | null = isOrganizer
    ? { icon: VIEW_SWITCH_ICON, onPress: open, accessibilityLabel: t('viewSwitch.buttonLabel') }
    : null;

  const dialog = isOrganizer ? (
    <CenterDialog
      visible={visible}
      onDismiss={close}
      title={t('viewSwitch.title')}
      titleVariant="plain"
    >
      {OPTIONS.map((option) => {
        const current = option.mode === viewMode;
        const name = t(option.labelKey);
        return (
          <TouchableOpacity
            key={option.mode}
            style={[styles.option, current && styles.optionCurrent]}
            onPress={() => choose(option.mode)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected: current }}
            accessibilityLabel={name}
          >
            <View style={styles.optionIcon}>
              <Ionicons name={option.icon} size={22} color="#FFFFFF" />
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>{name}</Text>
              <Text style={styles.optionSubtitle}>
                {current ? t('viewSwitch.current') : t('viewSwitch.switchTo', { name })}
              </Text>
            </View>
            {current ? <Ionicons name="checkmark-circle" size={24} color={colors.primary} /> : null}
          </TouchableOpacity>
        );
      })}
    </CenterDialog>
  ) : null;

  return { canSwitch: isOrganizer, open, headerAction, dialog };
}

/** Top-bar button for screens that draw their own header instead of `ScreenHeader`. */
export function ViewModeSwitchButton({
  style,
  color = '#FFFFFF',
}: {
  style?: StyleProp<ViewStyle>;
  color?: string;
}) {
  const { t } = useTranslation();
  const { canSwitch, open, dialog } = useViewModeSwitch();

  if (!canSwitch) return null;

  return (
    <>
      <TouchableOpacity
        style={[styles.button, style]}
        onPress={open}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={t('viewSwitch.buttonLabel')}
      >
        <Ionicons name={VIEW_SWITCH_ICON} size={22} color={color} />
      </TouchableOpacity>
      {dialog}
    </>
  );
}

const styles = StyleSheet.create({
  button: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: `${colors.primary}0A`,
  },
  optionCurrent: { borderColor: colors.primary },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  optionText: { flex: 1 },
  optionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  optionSubtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
});
