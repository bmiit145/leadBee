import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Menu } from 'react-native-paper';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leadService } from '../services/lead.service';
import { queryKeys } from '../lib/queryKeys';
import { LeadThreadChannel } from '../types';
import { Avatar, ThreadComposer, ConfirmDialog } from './ui';
import { useAuth } from '../stores/auth.store';
import { colors, spacing, borderRadius } from '../theme';

/** Canned taps shown in the composer sheet on the Time Line and Notes threads. */
const CANNED = ['Call Not Received', 'Switched Off', 'Call Busy', 'Call Back Later', 'Meeting Scheduled'];

const EMPTY_LABEL: Record<LeadThreadChannel, string> = {
  timeline: 'No Comments Found',
  notes: 'No Notes Found',
  query: 'No Queries Found',
};

const NOUN: Record<LeadThreadChannel, string> = {
  timeline: 'comment',
  notes: 'note',
  query: 'query',
};

interface Props {
  leadId: string;
  channel: LeadThreadChannel;
  placeholder?: string;
  /** Show the canned quick-reply chips (Time Line + Notes). */
  showCanned?: boolean;
  /** Rendered above the feed, scrolling with it (Time Line uses it for the
   *  stage pipeline). */
  header?: React.ReactNode;
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/**
 * One Lead Details conversation thread (Time Line / Notes / Ask Query): a
 * scrolling feed that fills the tab with the shared `ThreadComposer` docked at
 * the bottom. Each of your own entries has an Edit / Delete menu on the "···".
 * All three channels use this component and differ only by `channel`,
 * placeholder and whether the canned chips show.
 */
export function LeadThreadPanel({ leadId, channel, placeholder, showCanned, header }: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const key = queryKeys.leads.thread(leadId, channel);

  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => leadService.getThread(leadId, channel),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const addMutation = useMutation({
    mutationFn: (text: string) => leadService.addThreadItem(leadId, channel, text),
    onSuccess: invalidate,
    onError: () => Alert.alert('Error', 'Could not post. Try again.'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => leadService.updateThreadItem(leadId, id, text),
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
    onError: () => Alert.alert('Error', 'Could not save the edit.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (itemId: string) => leadService.deleteThreadItem(leadId, itemId),
    onSuccess: () => {
      invalidate();
      setDeletingId(null);
    },
    onError: () => Alert.alert('Error', 'Could not delete.'),
  });

  const items = data?.data ?? [];

  return (
    <View style={styles.fill}>
      <ScrollView contentContainerStyle={styles.feed} showsVerticalScrollIndicator={false}>
        {header}

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{EMPTY_LABEL[channel]}</Text>
          </View>
        ) : (
          <>
            <Text style={styles.count}>
              Showing {items.length} {items.length === 1 ? 'entry' : 'entries'}
            </Text>
            {items.map((it) => {
              const mine = it.createdByUser === user?._id;
              return (
                <View key={it._id} style={styles.msgRow}>
                  <Avatar name={it.createdByName} size={32} variant="solid" />
                  <View style={styles.msgBody}>
                    <View style={styles.msgHead}>
                      <Text style={styles.msgName}>{it.createdByName}</Text>
                      {mine && (
                        <Menu
                          visible={menuFor === it._id}
                          onDismiss={() => setMenuFor(null)}
                          contentStyle={styles.menu}
                          anchor={
                            <TouchableOpacity onPress={() => setMenuFor(it._id)} hitSlop={8}>
                              <Ionicons name="ellipsis-horizontal" size={16} color={colors.textSecondary} />
                            </TouchableOpacity>
                          }
                        >
                          <Menu.Item
                            onPress={() => {
                              setMenuFor(null);
                              setEditing({ id: it._id, text: it.text });
                            }}
                            title="Edit"
                            titleStyle={styles.menuItemText}
                            leadingIcon="pencil"
                          />
                          <Menu.Item
                            onPress={() => {
                              setMenuFor(null);
                              setDeletingId(it._id);
                            }}
                            title="Delete"
                            titleStyle={styles.menuItemText}
                            leadingIcon="delete"
                          />
                        </Menu>
                      )}
                    </View>
                    <View style={styles.bubble}>
                      <Text style={styles.bubbleText}>{it.text}</Text>
                      <Text style={styles.bubbleTime}>{timeAgo(it.createdAt)}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>

      <ThreadComposer
        placeholder={placeholder}
        cannedReplies={showCanned ? CANNED : undefined}
        onSubmit={(t) => addMutation.mutate(t)}
        submitting={addMutation.isPending || updateMutation.isPending}
        editing={editing ? { text: editing.text } : null}
        onUpdate={(t) => editing && updateMutation.mutate({ id: editing.id, text: t })}
        onCancelEdit={() => setEditing(null)}
      />

      <ConfirmDialog
        visible={!!deletingId}
        title={`Delete ${NOUN[channel]}`}
        message={`Are you sure you want to delete this ${NOUN[channel]}? This action cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
        onCancel={() => setDeletingId(null)}
        onConfirm={() => deletingId && deleteMutation.mutate(deletingId)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  feed: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  loader: { marginVertical: spacing.xl },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl },
  emptyText: { fontSize: 14, color: colors.textSecondary },
  count: { fontSize: 11.5, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xs },
  msgRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  msgBody: { flex: 1 },
  msgHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  msgName: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
  bubble: { backgroundColor: colors.surface, borderRadius: borderRadius.md, padding: spacing.sm, marginTop: 2 },
  bubbleText: { fontSize: 13, color: colors.text },
  bubbleTime: { fontSize: 10.5, color: colors.textDisabled, marginTop: 4, textAlign: 'right' },
  menu: { backgroundColor: colors.primary, borderRadius: borderRadius.lg },
  menuItemText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
});
