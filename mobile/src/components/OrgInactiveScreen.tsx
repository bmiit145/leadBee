import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Button } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius } from '../theme';

/**
 * Shown when the API reports the organization is suspended, cancelled, or its
 * trial has lapsed.
 *
 * Deliberately not the login screen. The user's credentials are fine — sending
 * them to sign in again would have them retype a correct password and be
 * refused with the same opaque message, which is how a billing problem turns
 * into a support ticket about "the app is broken". This says what happened and
 * who can fix it.
 */
export function OrgInactiveScreen({
  message,
  onSignOut,
}: {
  message: string;
  onSignOut: () => void | Promise<void>;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Ionicons name="lock-closed-outline" size={40} color={colors.error} />
        </View>

        <Text style={styles.title}>Access paused</Text>
        <Text style={styles.message}>{message}</Text>

        <Text style={styles.hint}>
          Your account and your data are safe. An administrator at your organization
          can restore access.
        </Text>

        <Button
          mode="outlined"
          onPress={onSignOut}
          icon="logout"
          style={styles.button}
          textColor={colors.textSecondary}
        >
          Sign out
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  content: { alignItems: 'center' },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.error + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  message: {
    fontSize: 15,
    color: colors.text,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  hint: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: spacing.xl,
  },
  button: {
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    minWidth: 160,
  },
});
