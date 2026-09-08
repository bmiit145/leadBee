import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '../../theme';
import { TaskComment } from '../../types';
import { useAuth } from '../../stores/auth.store';
import { CenterDialog } from './CenterDialog';
import { Avatar } from './Avatar';

interface Props {
  comments: TaskComment[];
  onSubmit: (text: string) => void;
  /** Edit/delete are local-only when omitted — pass these once the backend
   *  supports mutating a single comment. */
  onEdit?: (commentId: string, text: string) => void;
  onDelete?: (commentId: string) => void;
  submitting?: boolean;
  /** Input placeholder — defaults to "Enter Your Comments"; the Notes thread
   *  passes "Enter Your Notes". */
  placeholder?: string;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/**
 * The "Meeting Purpose" / "Add Comments" composer: an avatar + pill input +
 * send button, with submitted entries rendering below as a mini feed (avatar,
 * bold name, bubble, timestamp). Tapping "···" on your own comment offers
 * Edit/Delete — matches the reference app's Create Meeting and Create Task
 * screens, which use the identical pattern for both fields.
 */
export function CommentComposer({
  comments,
  onSubmit,
  onEdit,
  onDelete,
  submitting,
  placeholder = 'Enter Your Comments',
}: Props) {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<TaskComment | null>(null);
  const [editText, setEditText] = useState('');

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setText('');
  };

  const handleMenu = (comment: TaskComment) => {
    Alert.alert(comment.text, undefined, [
      ...(onEdit
        ? [{ text: 'Edit', onPress: () => { setEditing(comment); setEditText(comment.text); } }]
        : []),
      ...(onDelete ? [{ text: 'Delete', style: 'destructive' as const, onPress: () => onDelete(comment._id) }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const submitEdit = () => {
    if (editing && editText.trim()) onEdit?.(editing._id, editText.trim());
    setEditing(null);
  };

  return (
    <View>
      <View style={styles.composerRow}>
        <Avatar name={user?.name ?? '?'} size={32} variant="solid" />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={colors.textDisabled}
          style={styles.input}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!text.trim() || submitting) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!text.trim() || submitting}
        >
          <Ionicons name="send" size={16} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {comments.map((c) => (
        <View key={c._id} style={styles.commentRow}>
          <Avatar name={c.userName} size={32} variant="solid" />
          <View style={{ flex: 1 }}>
            <View style={styles.commentHeaderRow}>
              <Text style={styles.commentName}>{c.userName}</Text>
              {(onEdit || onDelete) && c.userId === user?._id && (
                <TouchableOpacity onPress={() => handleMenu(c)} style={styles.menuBtn}>
                  <Ionicons name="ellipsis-horizontal" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.bubble}>
              <Text style={styles.bubbleText}>{c.text}</Text>
              <Text style={styles.bubbleTime}>{timeAgo(c.createdAt)}</Text>
            </View>
          </View>
        </View>
      ))}

      <CenterDialog visible={!!editing} onDismiss={() => setEditing(null)} title="Edit Comment">
        <TextInput
          value={editText}
          onChangeText={setEditText}
          style={styles.editInput}
          multiline
          autoFocus
        />
        <TouchableOpacity style={styles.editSaveBtn} onPress={submitEdit}>
          <Text style={styles.editSaveText}>Save</Text>
        </TouchableOpacity>
      </CenterDialog>
    </View>
  );
}

const styles = StyleSheet.create({
  composerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
    maxHeight: 80,
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: `${colors.primary}20`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.5 },
  commentRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'flex-start' },
  commentHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  commentName: { fontSize: 13, fontWeight: '700', color: colors.primary },
  menuBtn: { padding: 4 },
  bubble: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginTop: 2,
  },
  bubbleText: { fontSize: 13.5, color: colors.text },
  bubbleTime: { fontSize: 10.5, color: colors.textDisabled, marginTop: 4, textAlign: 'right' },
  editInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.sm,
    minHeight: 80,
    fontSize: 14,
    color: colors.text,
    textAlignVertical: 'top',
  },
  editSaveBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  editSaveText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});
