import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, borderRadius } from '../../theme';
import { BottomSheet } from '../ui';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  onConfirm: (note: string | undefined) => void;
  title: string;
  message: string;
  confirmLabel: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** `danger` for declining and withdrawing, `primary` for accepting. */
  tone: 'primary' | 'danger';
  loading?: boolean;
}

/**
 * Confirms a decision on a transfer request, with room for a short note.
 *
 * The note is optional — nobody should have to justify accepting — but a
 * decline without one leaves the sender guessing, so the field is always offered.
 */
export function TransferDecisionSheet({
  visible,
  onDismiss,
  onConfirm,
  title,
  message,
  confirmLabel,
  icon,
  tone,
  loading,
}: Props) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');

  useEffect(() => {
    if (visible) setNote('');
  }, [visible]);

  const accent = tone === 'danger' ? colors.error : colors.primary;

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss}>
      <View style={[styles.badge, { backgroundColor: `${accent}14` }]}>
        <Ionicons name={icon} size={28} color={accent} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>

      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder={t('transfers.decide.notePlaceholder')}
        placeholderTextColor={colors.textSecondary}
        style={styles.note}
        multiline
        maxLength={500}
        textAlignVertical="top"
      />

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.btn, styles.backBtn]}
          onPress={onDismiss}
          disabled={loading}
          accessibilityRole="button"
        >
          <Text style={styles.backText}>{t('transfers.decide.back')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: accent }, loading && styles.btnOff]}
          onPress={() => onConfirm(note.trim() || undefined)}
          disabled={loading}
          accessibilityRole="button"
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.confirmText}>{confirmLabel}</Text>
          )}
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  title: { fontSize: 18, fontWeight: '800', color: colors.text, textAlign: 'center' },
  message: {
    fontSize: 13.5,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 6,
  },
  note: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 64,
    fontSize: 14.5,
    color: colors.text,
    marginTop: spacing.md,
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  btn: { flex: 1, borderRadius: borderRadius.full, paddingVertical: 13, alignItems: 'center' },
  btnOff: { opacity: 0.6 },
  backBtn: { borderWidth: 1.5, borderColor: colors.primary },
  backText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  confirmText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});
