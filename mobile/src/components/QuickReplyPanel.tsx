import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Linking, Alert, ScrollView, Share } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { Ionicons } from '@expo/vector-icons';
import { Menu } from 'react-native-paper';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { quickReplyService } from '../services/quickReply.service';
import { queryKeys } from '../lib/queryKeys';
import { QuickReply } from '../types';
import { SearchBar, BottomSheet, EmptyState, PrimaryButton, ConfirmDialog } from './ui';
import { TextField } from './fields/TextField';
import { colors, spacing, borderRadius } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function toDialable(raw: string): string {
  const d = (raw || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d;
  return d.length === 10 ? `+91${d}` : d;
}

interface Props {
  /** The lead's phone, the WhatsApp target. Absent on the drawer's Quick Replies
   *  screen, where there is no lead: a reply is shared through the system sheet. */
  phone?: string;
}

/**
 * The "Quick Reply" tab: search + list of the user's saved WhatsApp canned
 * messages, a create/edit sheet, and one-tap send to this lead over WhatsApp.
 */
export function QuickReplyPanel({ phone }: Props) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<QuickReply | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<QuickReply | null>(null);
  const [shortcut, setShortcut] = useState('');
  const [message, setMessage] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.quickReplies.list(debouncedSearch),
    queryFn: () => quickReplyService.list(debouncedSearch || undefined),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.quickReplies.all });

  const saveMutation = useMutation({
    mutationFn: () =>
      editing
        ? quickReplyService.update(editing._id, { shortcut, message })
        : quickReplyService.create({ shortcut, message }),
    onSuccess: () => {
      invalidate();
      setSheetOpen(false);
    },
    onError: () => Alert.alert('Error', 'Could not save quick reply.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => quickReplyService.remove(id),
    onSuccess: invalidate,
    onError: () => Alert.alert('Error', 'Could not delete quick reply.'),
  });

  const openCreate = () => {
    setEditing(null);
    setShortcut('');
    setMessage('');
    setSheetOpen(true);
  };
  const openEdit = (qr: QuickReply) => {
    setEditing(qr);
    setShortcut(qr.shortcut);
    setMessage(qr.message);
    setSheetOpen(true);
  };

  const send = (text: string) => {
    if (!phone) {
      Share.share({ message: text }).catch(() => undefined);
      return;
    }
    Linking.openURL(`whatsapp://send?phone=${toDialable(phone)}&text=${encodeURIComponent(text)}`).catch(() =>
      Alert.alert('WhatsApp is not installed.'),
    );
  };

  const rows = data ?? [];

  return (
    <View style={styles.wrap}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search Quick Replies" />

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="chatbubbles-outline"
            title="No quick replies"
            message="Create a canned message to send in one tap."
            actionLabel="Create Quick Reply"
            onAction={openCreate}
          />
        ) : (
          <>
            <Text style={styles.count}>
              Showing {rows.length} quick {rows.length === 1 ? 'reply' : 'replies'}
            </Text>
            {rows.map((qr, i) => (
              <View key={qr._id} style={styles.row}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{i + 1}</Text>
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.shortcut}>{qr.shortcut}</Text>
                <Text style={styles.message} numberOfLines={2}>
                  {qr.message}
                </Text>
              </View>
              <Menu
                visible={menuFor === qr._id}
                onDismiss={() => setMenuFor(null)}
                contentStyle={styles.menu}
                anchor={
                  <TouchableOpacity onPress={() => setMenuFor(qr._id)} hitSlop={8} accessibilityLabel={`Actions for ${qr.shortcut}`}>
                    <Ionicons name="ellipsis-vertical" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                }
              >
                <Menu.Item
                  onPress={() => {
                    setMenuFor(null);
                    openEdit(qr);
                  }}
                  title="Edit"
                  titleStyle={styles.menuItemText}
                  leadingIcon="pencil"
                />
                <Menu.Item
                  onPress={() => {
                    setMenuFor(null);
                    setDeleting(qr);
                  }}
                  title="Delete"
                  titleStyle={styles.menuItemText}
                  leadingIcon="delete"
                />
              </Menu>
              <TouchableOpacity style={styles.sendBtn} onPress={() => send(qr.message)} accessibilityLabel={phone ? 'Send on WhatsApp' : t('quickReplies.share')}>
                <Ionicons name="share-social" size={15} color="#1E8E5A" />
              </TouchableOpacity>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + spacing.md }]}
        onPress={openCreate}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Create Quick Reply"
      >
        <Ionicons name="add" size={30} color="#FFFFFF" />
      </TouchableOpacity>

      <BottomSheet visible={sheetOpen} onDismiss={() => setSheetOpen(false)}>
        <Text style={styles.sheetTitle}>{editing ? 'Edit Quick Reply' : 'Create Quick Reply'}</Text>
        <View style={styles.sheetBody}>
          <TextField
            label="Shortcut"
            value={shortcut}
            onChangeText={setShortcut}
            placeholder="A word that will quickly retrieve this reply"
          />
          <TextField
            label="Reply message"
            value={message}
            onChangeText={setMessage}
            placeholder="Enter Your Reply message"
            multiline
          />
          <PrimaryButton
            label={editing ? 'Save' : 'Create'}
            onPress={() => saveMutation.mutate()}
            disabled={!shortcut.trim() || !message.trim() || saveMutation.isPending}
          />
        </View>
      </BottomSheet>

      <ConfirmDialog
        visible={!!deleting}
        title="Delete Quick Reply"
        message={`Are you sure you want to delete "${deleting?.shortcut ?? ''}"? This action cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting._id)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: 96, gap: spacing.sm, flexGrow: 1 },
  loader: { marginVertical: spacing.lg },
  count: { fontSize: 12, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    padding: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  badge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: `${colors.primary}14`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 12, fontWeight: '800', color: colors.primary },
  rowBody: { flex: 1 },
  shortcut: { fontSize: 14, fontWeight: '700', color: colors.primary },
  message: { fontSize: 13, color: colors.text, marginTop: 1 },
  sendBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#1E8E5A14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    position: 'absolute',
    right: spacing.md,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
  },
  menu: { backgroundColor: colors.primary, borderRadius: borderRadius.lg },
  menuItemText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  sheetTitle: { fontSize: 16, fontWeight: '800', color: colors.text, textAlign: 'center', marginBottom: spacing.md },
  sheetBody: { gap: spacing.md },
});
