import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Pressable,
} from 'react-native';
import { TextInput, Button } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { CallOutcome } from '../types';
import { colors, spacing, borderRadius } from '../theme';

const OUTCOMES: { value: CallOutcome; label: string; icon: string; color: string }[] = [
  { value: 'answered', label: 'Answered', icon: 'call', color: '#22C55E' },
  { value: 'not_answered', label: 'Not Answered', icon: 'call-outline', color: '#EF4444' },
  { value: 'busy', label: 'Busy', icon: 'time-outline', color: '#F97316' },
  { value: 'callback_requested', label: 'Callback Requested', icon: 'refresh-circle-outline', color: '#3B82F6' },
  { value: 'interested', label: 'Interested', icon: 'heart-outline', color: '#10B981' },
  { value: 'not_interested', label: 'Not Interested', icon: 'close-circle-outline', color: '#9CA3AF' },
  { value: 'converted', label: 'Converted', icon: 'checkmark-circle', color: '#22C55E' },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: {
    outcome: CallOutcome;
    notes?: string;
    nextFollowUpAt?: string;
    duration?: number;
  }) => Promise<void>;
}

export function AddCallLogModal({ visible, onClose, onSubmit }: Props) {
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [notes, setNotes] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setOutcome(null);
    setNotes('');
    setFollowUpDate('');
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async () => {
    if (!outcome) {
      Alert.alert('Required', 'Please select a call outcome.');
      return;
    }

    let nextFollowUpAt: string | undefined;
    if (followUpDate.trim()) {
      const parsed = new Date(followUpDate.trim());
      if (isNaN(parsed.getTime())) {
        Alert.alert('Invalid Date', 'Use format: YYYY-MM-DD or YYYY-MM-DD HH:MM');
        return;
      }
      nextFollowUpAt = parsed.toISOString();
    }

    try {
      setSubmitting(true);
      await onSubmit({ outcome, notes: notes.trim() || undefined, nextFollowUpAt });
      reset();
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Failed to log call.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <Pressable style={styles.overlay} onPress={handleClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>Log a Call</Text>

          <Text style={styles.label}>Outcome *</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.outcomeRow}>
            {OUTCOMES.map((item) => {
              const isSelected = outcome === item.value;
              return (
                <TouchableOpacity
                  key={item.value}
                  style={[styles.outcomeChip, isSelected && { backgroundColor: item.color + '20', borderColor: item.color }]}
                  onPress={() => setOutcome(item.value)}
                  activeOpacity={0.7}
                >
                  <Ionicons name={item.icon as any} size={14} color={isSelected ? item.color : colors.textSecondary} />
                  <Text style={[styles.outcomeLabel, isSelected && { color: item.color, fontWeight: '700' }]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TextInput
            label="Notes (optional)"
            mode="outlined"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            style={styles.input}
            textColor={colors.inputText}
            outlineColor={colors.inputBorder}
            activeOutlineColor={colors.inputBorderFocused}
          />

          <TextInput
            label="Follow-up date (YYYY-MM-DD)"
            mode="outlined"
            value={followUpDate}
            onChangeText={setFollowUpDate}
            style={styles.input}
            textColor={colors.inputText}
            outlineColor={colors.inputBorder}
            activeOutlineColor={colors.inputBorderFocused}
            placeholder="e.g. 2026-07-01"
          />

          <View style={styles.actions}>
            <Button mode="outlined" onPress={handleClose} style={styles.actionBtn}>
              Cancel
            </Button>
            <Button
              mode="contained"
              onPress={handleSubmit}
              loading={submitting}
              disabled={submitting}
              buttonColor={colors.primary}
              style={styles.actionBtn}
            >
              Log Call
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  outcomeRow: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  outcomeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: borderRadius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    marginRight: 8,
    backgroundColor: colors.background,
  },
  outcomeLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  input: {
    backgroundColor: colors.surface,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  actionBtn: {
    flex: 1,
    borderRadius: borderRadius.lg,
  },
});
