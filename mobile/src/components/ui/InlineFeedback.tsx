import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { borderRadius, colors, spacing } from '../../theme';

type FeedbackTone = 'error' | 'warning' | 'success' | 'info';

interface InlineFeedbackProps {
  message: string;
  title?: string;
  tone?: FeedbackTone;
  onDismiss?: () => void;
}

const toneConfig: Record<FeedbackTone, { color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  error: { color: colors.error, icon: 'alert-circle-outline' },
  warning: { color: colors.warning, icon: 'warning-outline' },
  success: { color: colors.success, icon: 'checkmark-circle-outline' },
  info: { color: colors.info, icon: 'information-circle-outline' },
};

/**
 * A compact, non-blocking status message for form and screen-level feedback.
 * Use this for recoverable results; reserve ConfirmDialog for destructive
 * decisions and native alerts only for OS-level actions.
 */
export function InlineFeedback({
  message,
  title,
  tone = 'info',
  onDismiss,
}: InlineFeedbackProps) {
  const config = toneConfig[tone];

  return (
    <View
      style={[styles.container, { borderColor: config.color }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
    >
      <Ionicons name={config.icon} size={20} color={config.color} style={styles.icon} />
      <View style={styles.copy}>
        {title ? <Text style={styles.title}>{title}</Text> : null}
        <Text style={styles.message}>{message}</Text>
      </View>
      {onDismiss ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss message"
          hitSlop={8}
          onPress={onDismiss}
          style={styles.dismiss}
        >
          <Ionicons name="close" size={18} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceVariant,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  icon: { marginTop: 1 },
  copy: { flex: 1, marginLeft: spacing.sm },
  title: { color: colors.text, fontSize: 13, fontWeight: '700', marginBottom: 2 },
  message: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  dismiss: { marginLeft: spacing.xs, paddingTop: 1 },
});
