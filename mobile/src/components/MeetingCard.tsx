import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Meeting, User } from '../types';
import { colors, spacing, borderRadius } from '../theme';
import { MEETING_TYPE_META, formatDuration, meetingDisplayStatus } from '../config/taskMeeting';
import { StatusChip, Avatar } from './ui';
import { MemberStack } from './MemberStack';

interface Props {
  meeting: Meeting;
  onPress: () => void;
}

const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

const timeLabel = (d: Date) =>
  d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

/**
 * A meeting in a list: who with, when it runs, where it stands and how it is
 * held. An open meeting shows its day (Today / Tomorrow); one whose time has
 * passed unresolved shows Missed; a closed one shows its outcome.
 */
export function MeetingCard({ meeting, onPress }: Props) {
  const { t } = useTranslation();
  const lead = typeof meeting.leadId === 'object' ? meeting.leadId : null;
  const start = new Date(meeting.scheduledAt);
  const end = new Date(start.getTime() + meeting.durationMinutes * 60_000);
  const display = meetingDisplayStatus(meeting);
  const typeMeta = MEETING_TYPE_META[meeting.meetingType];
  const attendees = meeting.assignedTo.filter((m): m is User => typeof m === 'object');

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const pill =
    display.key === 'scheduled' && isSameDay(start, new Date())
      ? { label: t('work.meetingTabs.today'), color: colors.primary }
      : display.key === 'scheduled' && isSameDay(start, tomorrow)
        ? { label: t('work.meetingTabs.tomorrow'), color: colors.textSecondary }
        : { label: t(`work.meetingStatus.${display.key}`), color: display.color };

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75} accessibilityRole="button">
      <View style={styles.headerRow}>
        <View style={styles.identity}>
          <Avatar name={lead?.contactName} size={40} />
          <View style={styles.identityText}>
            <Text style={styles.name} numberOfLines={1}>
              {lead?.contactName ?? t('work.unknownContact')}
            </Text>
            {lead?.contactPhone ? <Text style={styles.phone}>{lead.contactPhone}</Text> : null}
          </View>
        </View>
        <View style={[styles.statusPill, { borderColor: pill.color }]}>
          <Text style={[styles.statusPillText, { color: pill.color }]}>{pill.label.toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.timeline}>
        <View style={styles.timeBlock}>
          <Text style={styles.timeCaption}>{t('work.startTime')}</Text>
          <Text style={styles.timeValue}>{timeLabel(start)}</Text>
        </View>
        <View style={styles.track}>
          <Text style={styles.duration}>{formatDuration(meeting.durationMinutes)}</Text>
          <View style={styles.dashedLine} />
        </View>
        <View style={[styles.timeBlock, { alignItems: 'flex-end' }]}>
          <Text style={styles.timeCaption}>{t('work.endTime')}</Text>
          <Text style={styles.timeValue}>{timeLabel(end)}</Text>
        </View>
      </View>

      <View style={styles.footerRow}>
        <View style={styles.datePill}>
          <Ionicons name="calendar-outline" size={13} color={colors.primary} />
          <Text style={styles.datePillText}>
            {start.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
          </Text>
        </View>
        <View style={styles.footerEnd}>
          <MemberStack members={attendees} size={24} />
          <StatusChip
            label={t(`work.meetingType.${meeting.meetingType}`)}
            color={colors.primary}
            icon={typeMeta.icon as never}
            filled
            size="md"
          />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: 10,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  identityText: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  phone: { fontSize: 12.5, color: colors.textSecondary, fontWeight: '600' },
  statusPill: { borderWidth: 1.5, borderRadius: borderRadius.full, paddingHorizontal: 10, paddingVertical: 3 },
  statusPillText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.3 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  timeline: { flexDirection: 'row', alignItems: 'center' },
  timeBlock: { minWidth: 68 },
  timeCaption: { fontSize: 11, color: colors.textSecondary },
  timeValue: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 1 },
  track: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.xs },
  duration: { fontSize: 11, color: colors.primary, fontWeight: '600', marginBottom: 4 },
  dashedLine: {
    width: '100%',
    height: 0,
    borderTopWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: `${colors.primary}40`,
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  footerEnd: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  datePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.background,
    borderRadius: borderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  datePillText: { fontSize: 12, fontWeight: '700', color: colors.text },
});
