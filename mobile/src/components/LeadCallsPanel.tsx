import React, { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leadService } from '../services/lead.service';
import { queryKeys } from '../lib/queryKeys';
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

/**
 * The "Calls" tab: log a call and see this lead's call history. Split out of the
 * Time Line tab so that thread stays a pure conversation feed.
 */
export function LeadCallsPanel({ leadId }: Props) {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);

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
    mutationFn: (payload: Parameters<React.ComponentProps<typeof AddCallLogModal>['onSubmit']>[0]) =>
      leadService.addCallLog(leadId, payload),
    onSuccess: invalidate,
  });

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
                <Text style={styles.muted}>
                  {new Date(log.calledAt).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                  })}
                </Text>
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
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={async (payload) => {
          await addMutation.mutateAsync(payload);
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
  title: { fontSize: 14, fontWeight: '700', color: colors.text },
  muted: { fontSize: 12, color: colors.textSecondary },
  item: { paddingVertical: spacing.sm, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight, gap: 3 },
  outcome: { fontSize: 14, fontWeight: '700', color: colors.text },
  by: { fontSize: 13, color: colors.textSecondary },
  notes: { fontSize: 13, color: colors.text, fontStyle: 'italic' },
  followUp: { fontSize: 12, color: colors.primary, fontWeight: '500' },
});
