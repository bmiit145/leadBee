import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { leadService } from '../services/lead.service';
import { queryKeys } from '../lib/queryKeys';
import { CallLog } from '../types';
import { EmptyState } from './ui';
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

/** Minutes as the call list shows them: "4m", "1h 05m". */
function durationLabel(minutes?: number): string | null {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * The "Calls" tab: this lead's call history, read-only.
 *
 * Calls are no longer typed in by hand — they come from the phone's own call
 * log, matched to this lead's number (see docs/adr/0005). What was logged
 * before that change stays here, so the history a person built up is not lost.
 */
export function LeadCallsPanel({ leadId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.leads.callLogs(leadId),
    queryFn: () => leadService.getCallLogs(leadId),
  });

  const logs: CallLog[] = data?.data ?? [];

  if (isLoading) return <ActivityIndicator color={colors.primary} style={styles.loader} />;

  if (logs.length === 0) {
    return (
      <EmptyState
        icon="call-outline"
        title="No calls yet"
        message="Calls with this lead appear here once call tracking is switched on."
      />
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Call History</Text>
        <Text style={styles.muted}>{logs.length} total</Text>
      </View>

      {logs.map((log) => {
        const duration = durationLabel(log.duration);
        return (
          <View key={log._id} style={styles.item}>
            <View style={styles.headerRow}>
              <View style={styles.outcomeRow}>
                <Ionicons name="call-outline" size={14} color={colors.textSecondary} />
                {/* A measured call has a direction, not an outcome, until someone sets one. */}
                <Text style={styles.outcome}>
                  {log.outcome ? OUTCOME_LABELS[log.outcome] ?? log.outcome : log.direction ?? '—'}
                </Text>
                {duration ? <Text style={styles.muted}>· {duration}</Text> : null}
              </View>
              <Text style={styles.muted}>
                {new Date(log.calledAt).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
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
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
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
  outcomeRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  title: { fontSize: 14, fontWeight: '700', color: colors.text },
  muted: { fontSize: 12, color: colors.textSecondary },
  item: { paddingVertical: spacing.sm, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight, gap: 3 },
  outcome: { fontSize: 14, fontWeight: '700', color: colors.text },
  by: { fontSize: 13, color: colors.textSecondary },
  notes: { fontSize: 13, color: colors.text, fontStyle: 'italic' },
  followUp: { fontSize: 12, color: colors.primary, fontWeight: '500' },
});
