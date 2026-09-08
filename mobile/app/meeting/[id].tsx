import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { colors, spacing, borderRadius } from '../../src/theme';
import { meetingService } from '../../src/services/meeting.service';
import { MEETING_TYPE_META, MEETING_STATUS_META } from '../../src/config/taskMeeting';
import { ScreenHeader, StatusChip, Avatar } from '../../src/components/ui';
import { CommentsField } from '../../src/components/fields';

export default function MeetingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const { data: meeting, isLoading } = useQuery({
    queryKey: ['meeting', id],
    queryFn: () => meetingService.getById(id),
    enabled: !!id,
  });

  const statusMutation = useMutation({
    mutationFn: (status: 'completed' | 'cancelled') => meetingService.setStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meeting', id] });
      qc.invalidateQueries({ queryKey: ['meetings'] });
    },
    onError: (err: any) => Alert.alert('Error', err?.response?.data?.message || 'Failed to update meeting.'),
  });

  const commentMutation = useMutation({
    mutationFn: (text: string) => meetingService.addComment(id, text),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meeting', id] }),
  });

  if (isLoading || !meeting) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const lead = typeof meeting.leadId === 'object' ? meeting.leadId : null;
  const start = new Date(meeting.scheduledAt);
  const end = new Date(start.getTime() + meeting.durationMinutes * 60_000);
  const typeMeta = MEETING_TYPE_META[meeting.meetingType];
  const statusMeta = MEETING_STATUS_META[meeting.status];

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Meeting Details" />

      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + 32 }}>
        <View style={styles.card}>
          <View style={styles.identityRow}>
            <Avatar icon="person" size={44} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{lead?.contactName ?? 'Unknown Contact'}</Text>
              {lead?.contactPhone ? <Text style={styles.phone}>{lead.contactPhone}</Text> : null}
            </View>
            <StatusChip label={statusMeta.label} color={statusMeta.color} filled />
          </View>

          <View style={styles.divider} />

          <View style={styles.timeline}>
            <View>
              <Text style={styles.timeLabel}>Start Time</Text>
              <Text style={styles.timeValue}>
                {start.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}
              </Text>
            </View>
            <Ionicons name="arrow-forward" size={16} color={colors.textSecondary} />
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.timeLabel}>End Time</Text>
              <Text style={styles.timeValue}>
                {end.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}
              </Text>
            </View>
          </View>

          <View style={styles.footerRow}>
            <View style={styles.datePill}>
              <Ionicons name="calendar-outline" size={13} color={colors.primary} />
              <Text style={styles.datePillText}>
                {start.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </Text>
            </View>
            <StatusChip label={typeMeta.label} color={colors.primary} filled />
          </View>
        </View>

        {meeting.status === 'scheduled' && (
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={styles.completeBtn}
              onPress={() => statusMutation.mutate('completed')}
              disabled={statusMutation.isPending}
            >
              <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
              <Text style={styles.completeText}>Mark Completed</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() =>
                Alert.alert('Cancel Meeting', 'Are you sure you want to cancel this meeting?', [
                  { text: 'No', style: 'cancel' },
                  { text: 'Yes, Cancel', style: 'destructive', onPress: () => statusMutation.mutate('cancelled') },
                ])
              }
              disabled={statusMutation.isPending}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        <CommentsField
          label="Meeting Purpose"
          comments={meeting.comments ?? []}
          onSubmit={(text) => commentMutation.mutate(text)}
          submitting={commentMutation.isPending}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  card: {
    backgroundColor: colors.surface, borderRadius: borderRadius.xl, borderWidth: 1.5,
    borderColor: `${colors.primary}30`, padding: spacing.md, gap: 10,
  },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontSize: 16, fontWeight: '700', color: colors.text },
  phone: { fontSize: 13, color: colors.primary, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  timeline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timeLabel: { fontSize: 11, color: colors.textSecondary },
  timeValue: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 1 },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  datePill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#F4839014', borderRadius: borderRadius.full, paddingHorizontal: 10, paddingVertical: 5 },
  datePillText: { fontSize: 12, fontWeight: '700', color: colors.text },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  completeBtn: { flex: 1, flexDirection: 'row', gap: 6, backgroundColor: '#2C7A57', borderRadius: borderRadius.full, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  completeText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: '#BC5430', borderRadius: borderRadius.full, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: '#BC5430', fontWeight: '700', fontSize: 14 },
});
