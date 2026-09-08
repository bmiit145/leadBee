import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { colors, spacing } from '../../src/theme';
import { leadService } from '../../src/services/lead.service';
import { meetingService } from '../../src/services/meeting.service';
import { useAuth } from '../../src/stores/auth.store';
import { Lead, MeetingType, TaskComment } from '../../src/types';
import { MEETING_TYPE_META, MEETING_TYPE_ORDER } from '../../src/config/taskMeeting';
import { LeadSummaryCard } from '../../src/components/LeadSummaryCard';
import { MeetingSlotSheet } from '../../src/components/MeetingSlotSheet';
import {
  ScreenHeader,
  FieldLabel,
  FormField,
  PrimaryButton,
  StickyFooter,
  STICKY_FOOTER_SPACE,
} from '../../src/components/ui';
import {
  LeadField,
  DateField,
  MembersField,
  ReminderField,
  SelectField,
  CommentsField,
} from '../../src/components/fields';

const MEETING_TYPE_OPTIONS = MEETING_TYPE_ORDER.map((t) => ({
  value: t,
  label: MEETING_TYPE_META[t].label,
}));

function fmtTime(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
    .toUpperCase();
}

/** "1 hour" / "30 min" — the phrasing used beside a chosen slot. */
function fmtSlotDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hrs = minutes / 60;
  return `${hrs % 1 === 0 ? hrs : hrs.toFixed(1)} hour${hrs === 1 ? '' : 's'}`;
}

interface Slot {
  start: string;
  end: string;
  durationMinutes: number;
  freeCount: number;
}

export default function CreateMeetingScreen() {
  // leadId is optional: the screen works standalone (pick a lead here) or
  // pre-filled when opened from a lead's detail screen.
  const { leadId: leadIdParam } = useLocalSearchParams<{ leadId?: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [leadId, setLeadId] = useState<string | undefined>(leadIdParam);
  const [meetingDate, setMeetingDate] = useState<Date | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [slotSheetOpen, setSlotSheetOpen] = useState(false);
  const [reminders, setReminders] = useState<number[]>([]);
  const [meetingType, setMeetingType] = useState<MeetingType | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);

  const { data: lead, isLoading: leadLoading } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: () => leadService.getById(leadId!),
    enabled: !!leadId,
  });

  // Changing lead, date or attendees invalidates a chosen slot — availability
  // is computed per attendee per day, so a free slot may no longer be free.
  useEffect(() => { setSlot(null); }, [leadId, meetingDate, members]);

  const slotReady = !!leadId && !!meetingDate;
  const canCreate = !!(leadId && slot && meetingType);

  const createMutation = useMutation({
    mutationFn: () =>
      meetingService.create({
        leadId: leadId!,
        scheduledAt: slot!.start,
        durationMinutes: slot!.durationMinutes,
        meetingType: meetingType!,
        assignedTo: members,
        reminderMinutesBefore: reminders,
        comments,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meetings'] });
      qc.invalidateQueries({ queryKey: ['reminder-meetings'] });
      qc.invalidateQueries({ queryKey: ['home-reminder-meetings'] });
      router.back();
    },
    onError: (err: any) =>
      Alert.alert('Error', err?.response?.data?.message || 'Failed to create meeting.'),
  });

  const addComment = (text: string) =>
    setComments((prev) => [
      ...prev,
      {
        _id: `local-${Date.now()}`,
        userId: user?._id ?? '',
        userName: user?.name ?? 'Me',
        text,
        createdAt: new Date().toISOString(),
      },
    ]);

  const slotHint = !slotReady
    ? !leadId && !meetingDate
      ? 'Select a lead and meeting date first'
      : !leadId
        ? 'Select a lead first'
        : 'Select a meeting date first'
    : slot
      ? `${slot.freeCount} free slots · ${fmtSlotDuration(slot.durationMinutes)} each`
      : undefined;

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Create Meeting" />

      <ScrollView
        contentContainerStyle={{ padding: spacing.md, paddingBottom: STICKY_FOOTER_SPACE }}
        keyboardShouldPersistTaps="handled"
      >
        <LeadField lead={lead} selectedId={leadId} onSelect={(l: Lead) => setLeadId(l._id)} />

        {leadLoading && leadId ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
        ) : lead ? (
          <View style={{ marginTop: spacing.md }}>
            <LeadSummaryCard lead={lead} />
          </View>
        ) : null}

        <DateField
          label="Meeting Date"
          required
          value={meetingDate}
          onChange={setMeetingDate}
          placeholder="Select Meeting Date"
          dialogTitle="Select meeting date"
        />

        <MembersField value={members} onChange={setMembers} label="Meeting Assign" />

        <FieldLabel required>Meeting Time</FieldLabel>
        <FormField
          icon="time"
          value={
            slot
              ? `${fmtTime(slot.start)} – ${fmtTime(slot.end)} (${fmtSlotDuration(slot.durationMinutes)})`
              : null
          }
          placeholder="Choose Time Slot"
          hint={slotHint}
          disabled={!slotReady}
          onPress={() => setSlotSheetOpen(true)}
        />

        {/* Reminders are multi-value app-wide — same field the lead flow uses. */}
        <ReminderField values={reminders} onChange={setReminders} />

        <SelectField
          label="Meeting Type"
          required
          icon="people"
          placeholder="Select Meeting Type"
          dialogTitle="Select Meeting Type"
          options={MEETING_TYPE_OPTIONS}
          value={meetingType}
          onChange={setMeetingType}
        />

        <CommentsField label="Meeting Purpose" comments={comments} onSubmit={addComment} />
      </ScrollView>

      <StickyFooter>
        <PrimaryButton
          label="Create"
          onPress={() => createMutation.mutate()}
          disabled={!canCreate}
          loading={createMutation.isPending}
        />
      </StickyFooter>

      {meetingDate ? (
        <MeetingSlotSheet
          visible={slotSheetOpen}
          onDismiss={() => setSlotSheetOpen(false)}
          date={meetingDate}
          assignedTo={members}
          initialDurationMinutes={slot?.durationMinutes ?? 60}
          onApply={setSlot}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
});
