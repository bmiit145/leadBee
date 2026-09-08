import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '../../theme';
import { useAuth } from '../../stores/auth.store';
import { Avatar } from './Avatar';
import { BottomSheet } from './BottomSheet';

interface Props {
  /** Placeholder on both the docked bar and the sheet input. */
  placeholder?: string;
  /** Canned phrases shown as tappable chips in the sheet; a tap appends the
   *  phrase to the draft (matches the reference app). Omit to hide the row. */
  cannedReplies?: string[];
  onSubmit: (text: string) => void;
  submitting?: boolean;
  /** When set, the sheet opens in edit mode pre-filled with `text`; send calls
   *  `onUpdate` instead of `onSubmit`. Clear it (set null) to close. */
  editing?: { text: string } | null;
  onUpdate?: (text: string) => void;
  /** Called when the user dismisses the sheet while editing. */
  onCancelEdit?: () => void;
}

/**
 * The reference app's universal message composer: a docked pill at the bottom
 * of a thread that, when tapped, raises a full-width bottom sheet with the real
 * input, the canned-reply chips and the send button. Used by every Lead Details
 * thread (Time Line / Notes / Ask Query) so the interaction never drifts
 * between them — including editing, which reuses this same sheet pre-filled
 * rather than a separate dialog.
 */
export function ThreadComposer({
  placeholder = 'Enter Your Comments',
  cannedReplies,
  onSubmit,
  submitting,
  editing,
  onUpdate,
  onCancelEdit,
}: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const wasEditing = useRef<boolean>(false);
  const isEditing = !!editing;

  // Enter edit mode when the parent sets `editing`; close when it clears it.
  useEffect(() => {
    if (editing && !wasEditing.current) {
      setText(editing.text);
      setOpen(true);
    } else if (!editing && wasEditing.current) {
      setOpen(false);
      setText('');
    }
    wasEditing.current = !!editing;
  }, [editing]);

  const name = user?.name ?? '?';
  const hasText = !!text.trim();
  const canSend = hasText && !submitting;

  const close = () => {
    setOpen(false);
    setText('');
    if (isEditing) onCancelEdit?.();
  };

  const send = () => {
    if (!canSend) return;
    const value = text.trim();
    if (isEditing) {
      onUpdate?.(value); // parent clears `editing` on success → effect closes the sheet
    } else {
      onSubmit(value);
      setOpen(false);
      setText('');
    }
  };

  const appendCanned = (phrase: string) =>
    setText((prev) => (prev.trim() ? `${prev.trim()} ${phrase}` : phrase));

  return (
    <>
      <View style={styles.dock}>
        <Avatar name={name} size={32} variant="solid" />
        <TouchableOpacity style={styles.dockPill} activeOpacity={0.7} onPress={() => setOpen(true)}>
          <Text style={styles.dockPlaceholder}>{placeholder}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dockSend} onPress={() => setOpen(true)} accessibilityLabel={placeholder}>
          <Ionicons name="paper-plane" size={16} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <BottomSheet visible={open} onDismiss={close} maxHeightRatio={0.6}>
        {isEditing && (
          <View style={styles.editHeader}>
            <Text style={styles.editHeaderText}>Edit message</Text>
            <TouchableOpacity onPress={close} hitSlop={8} accessibilityLabel="Cancel edit">
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.sheetRow}>
          <Avatar name={name} size={32} variant="solid" />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={placeholder}
            placeholderTextColor={colors.textDisabled}
            style={styles.input}
            multiline
            autoFocus
          />
          <TouchableOpacity
            style={[styles.send, !canSend && styles.sendOff]}
            onPress={send}
            disabled={!canSend}
            accessibilityLabel={isEditing ? 'Save changes' : 'Send'}
          >
            <Ionicons
              name={isEditing ? 'checkmark' : 'paper-plane'}
              size={isEditing ? 18 : 16}
              color={hasText ? colors.primary : colors.textDisabled}
            />
          </TouchableOpacity>
        </View>

        {!isEditing && cannedReplies && cannedReplies.length > 0 && (
          <View style={styles.chips}>
            {cannedReplies.map((c) => (
              <TouchableOpacity key={c} style={styles.chip} onPress={() => appendCanned(c)} activeOpacity={0.75}>
                <Text style={styles.chipText}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  dockPill: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  dockPlaceholder: { fontSize: 13, color: colors.textDisabled },
  dockSend: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: `${colors.primary}1A`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  editHeaderText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontSize: 13,
    color: colors.text,
    maxHeight: 110,
  },
  send: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: `${colors.primary}1A`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: { opacity: 0.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.primary },
});
