import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Meeting } from '../types';
import { colors, spacing, borderRadius } from '../theme';
import { MEETING_TYPE_META, formatDuration } from '../config/taskMeeting';
import { StatusChip, Avatar } from './ui';

interface Props {
  meeting: Meeting;
  onPress: () => void;
}

function isSameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

function relativeDayLabel(date: Date): string {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (isSameDay(date, now)) return 'TODAY';
  if (isSameDay(date, tomorrow)) return 'TOMORROW';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const timeLabel = (d: Date) =>
  d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

/**
 * The reminder-card layout used on Home's "Today's Reminder" and the Meetings
 * list: avatar/name/phone, a day pill, a dashed start-to-end timeline with the
 * duration centred on it, then a date pill and a filled meeting-type pill.
 */
export function MeetingCard({ meeting, onPress }: Props) {
  const lead = typeof meeting.leadId === 'object' ? meeting.leadId : null;
  const start = new Date(meeting.scheduledAt);
  const end = new Date(start.getTime() + meeting.durationMinutes * 60_000);
  // A scheduled meeting whose end time has passed without being resolved reads
  // as "MISSED" (amber) instead of its usual day label — matches the
  // reference app's Meetings list.
  const isMissed = meeting.status === 'scheduled' && end.getTime() < Date.now();
  const dayLabel = isMissed ? 'MISSED' : relativeDayLabel(start);
  const isToday = dayLabel === 'TODAY';
  const typeMeta = MEETING_TYPE_META[meeting.meetingType];

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.headerRow}>
        <View style={styles.identity}>
          <Avatar icon="person" size={38} />
          <View style={styles.identityText}>
            <Text style={styles.name} numberOfLines={1}>
              {lead?.contactName ?? 'Unknown Contact'}
            </Text>
            {lead?.contactPhone ? <Text style={styles.phone}>{lead.contactPhone}</Text> : null}
          </View>
        </View>

        <View style={[styles.dayPill, isToday && styles.dayPillToday, isMissed && styles.dayPillMissed]}>
          <Text
            style={[
              styles.dayPillText,
              isToday && styles.dayPillTextToday,
              isMissed && styles.dayPillTextMissed,
            ]}
          >
            {dayLabel}
          </Text>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.timeline}>
        <View style={styles.timeBlock}>
          <Text style={styles.timeLabel}>Start Time</Text>
          <Text style={styles.timeValue}>{timeLabel(start)}</Text>
        </View>

        <View style={styles.timelineTrack}>
          <Text style={styles.duration}>{formatDuration(meeting.durationMinutes)}</Text>
          <View style={styles.dashedLine} />
        </View>

        <View style={[styles.timeBlock, { alignItems: 'flex-end' }]}>
          <Text style={styles.timeLabel}>End Time</Text>
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
        <StatusChip label={typeMeta.label} color={colors.primary} filled />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    borderColor: `${colors.primary}30`,
    padding: spacing.md,
    marginBottom: 10,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  identityText: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  phone: { fontSize: 12.5, color: colors.primary, fontWeight: '600' },
  dayPill: {
    borderWidth: 1.5,
    borderColor: colors.textSecondary,
    borderRadius: borderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  dayPillToday: { borderColor: colors.primary },
  dayPillMissed: { borderColor: '#C2731F' },
  dayPillText: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  dayPillTextToday: { color: colors.primary },
  dayPillTextMissed: { color: '#C2731F' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  timeline: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeBlock: { minWidth: 68 },
  timeLabel: { fontSize: 11, color: colors.textSecondary },
  timeValue: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 1 },
  timelineTrack: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
  },
  duration: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '600',
    marginBottom: 4,
  },
  dashedLine: {
    width: '100%',
    height: 0,
    borderTopWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: `${colors.primary}60`,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  datePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F4839014',
    borderRadius: borderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  datePillText: { fontSize: 12, fontWeight: '700', color: colors.text },
});
