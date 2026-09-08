import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../../theme';

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
  children,
}: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

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
        {actions.length === 0 ? (
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
          </View>
        )}
      </View>

      {children}
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
