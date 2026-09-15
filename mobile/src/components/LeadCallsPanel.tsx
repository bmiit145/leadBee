import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leadService, type CallLogData } from '../services/lead.service';
import { queryKeys } from '../lib/queryKeys';
import { useAuth } from '../stores/auth.store';
import { CallLog } from '../types';
import { AddCallLogModal } from './AddCallLogModal';
import { EmptyState, PrimaryButton } from './ui';
import { colors, spacing, borderRadius } from '../theme';

const OUTCOME_LABELS: Record<string, string> = {
  answered: 'Answered',
  not_answered: 'Not Answered',
  busy: 'Busy',
  callback_requested: 'Callback Requested',
  interested: 'Interested',
  not_interested: 'Not Interested',
  converted: 'Converted',
};

interface Props {
  leadId: string;
}

const idOf = (value: unknown) =>
  value && typeof value === 'object' && '_id' in value ? String((value as { _id: string })._id) : String(value);

/**
 * The "Calls" tab: log a call, see this lead's call history, and correct or
 * delete a call you logged (organizers, any call). Split out of the Time Line
 * tab so that thread stays a pure conversation feed.
 */
export function LeadCallsPanel({ leadId }: Props) {
  const qc = useQueryClient();
  const { user, isOrganizer } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CallLog | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.leads.callLogs(leadId),
    queryFn: () => leadService.getCallLogs(leadId),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: queryKeys.leads.callLogs(leadId) });
    qc.invalidateQueries({ queryKey: queryKeys.leads.detail(leadId) });
    qc.invalidateQueries({ queryKey: queryKeys.leads.all });
    qc.invalidateQueries({ queryKey: queryKeys.leads.stats });
    qc.invalidateQueries({ queryKey: queryKeys.leads.thread(leadId, 'timeline') });
  };

  const addMutation = useMutation({
    mutationFn: (payload: CallLogData) => leadService.addCallLog(leadId, payload),
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CallLogData }) =>
      leadService.updateCallLog(leadId, id, payload),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => leadService.deleteCallLog(leadId, id),
    onSuccess: invalidate,
    onError: (err: any) =>
      Alert.alert('Error', err?.response?.data?.error?.message || 'Could not delete the call.'),
  });

  const canChange = (log: CallLog) => isOrganizer || idOf(log.calledBy) === user?._id;

  const openActions = (log: CallLog) => {
    Alert.alert('Logged call', OUTCOME_LABELS[log.outcome] ?? log.outcome, [
      { text: 'Edit', onPress: () => setEditing(log) },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Delete call', 'Remove this call from the lead’s history?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate(log._id) },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // Memoised: the modal re-fills its form whenever this object changes.
  const initial = useMemo(
    () =>
      editing
        ? { outcome: editing.outcome, notes: editing.notes, nextFollowUpAt: editing.nextFollowUpAt }
        : null,
    [editing]
  );

  const logs: CallLog[] = data?.data ?? [];

  return (
    <View style={styles.wrap}>
      <PrimaryButton label="Log a Call" onPress={() => setModalOpen(true)} />

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : logs.length === 0 ? (
        <EmptyState icon="call-outline" title="No calls logged" message="Log your first call with this lead." />
      ) : (
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Call History</Text>
            <Text style={styles.muted}>{logs.length} total</Text>
          </View>
          {logs.map((log) => (
            <View key={log._id} style={styles.item}>
              <View style={styles.headerRow}>
                <Text style={styles.outcome}>{OUTCOME_LABELS[log.outcome] ?? log.outcome}</Text>
                <View style={styles.itemMeta}>
                  <Text style={styles.muted}>
                    {new Date(log.calledAt).toLocaleDateString('en-IN', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </Text>
                  {canChange(log) ? (
                    <TouchableOpacity
                      onPress={() => openActions(log)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Call actions"
                    >
                      <Ionicons name="ellipsis-horizontal" size={16} color={colors.textSecondary} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
              <Text style={styles.by}>By {log.calledByName}</Text>
              {log.notes ? <Text style={styles.notes}>{log.notes}</Text> : null}
              {log.nextFollowUpAt ? (
                <Text style={styles.followUp}>
                  Follow-up:{' '}
                  {new Date(log.nextFollowUpAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      )}

      <AddCallLogModal
        visible={modalOpen || editing !== null}
        initial={initial}
        title={editing ? 'Edit Call' : 'Log a Call'}
        submitLabel={editing ? 'Save' : 'Log Call'}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSubmit={async (payload) => {
          if (editing) {
            await updateMutation.mutateAsync({ id: editing._id, payload });
          } else {
            await addMutation.mutateAsync(payload);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  loader: { marginVertical: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  itemMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: 14, fontWeight: '700', color: colors.text },
  muted: { fontSize: 12, color: colors.textSecondary },
  item: { paddingVertical: spacing.sm, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight, gap: 3 },
  outcome: { fontSize: 14, fontWeight: '700', color: colors.text },
  by: { fontSize: 13, color: colors.textSecondary },
  notes: { fontSize: 13, color: colors.text, fontStyle: 'italic' },
  followUp: { fontSize: 12, color: colors.primary, fontWeight: '500' },
});
