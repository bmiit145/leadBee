import React from 'react';
import { useRouter } from 'expo-router';
import { Lead, Meeting, Task } from '../types';
import { LeadCard } from './LeadCard';
import { MeetingCard } from './MeetingCard';
import { TaskCard } from './TaskCard';

type Props =
  | { kind: 'lead'; item: Lead }
  | { kind: 'meeting'; item: Meeting }
  | { kind: 'task'; item: Task };

/**
 * Renders one row of a reminder feed.
 *
 * A task's card depends on what it's attached to — matching the reference app:
 *   • origin 'meeting'  → the meeting's own timeline card, not a task card
 *   • linked to a lead  → that lead's card
 *   • standalone        → a plain task card
 * That rule lives here alone so the Reminder screen and Home's "Today's
 * Reminder" can never disagree about how the same task looks.
 */
export function ReminderFeedItem(props: Props) {
  const router = useRouter();

  if (props.kind === 'lead') {
    return <LeadCard lead={props.item} onPress={() => router.push(`/lead/${props.item._id}`)} />;
  }

  if (props.kind === 'meeting') {
    return (
      <MeetingCard meeting={props.item} onPress={() => router.push(`/meeting/${props.item._id}`)} />
    );
  }

  const task = props.item;

  if (task.origin === 'meeting' && typeof task.meetingId === 'object' && task.meetingId) {
    const meeting = task.meetingId as unknown as Meeting;
    return <MeetingCard meeting={meeting} onPress={() => router.push(`/meeting/${meeting._id}`)} />;
  }

  if (typeof task.leadId === 'object' && task.leadId) {
    const lead = task.leadId as unknown as Lead;
    return <LeadCard lead={lead} onPress={() => router.push(`/lead/${lead._id}`)} />;
  }

  return <TaskCard task={task} onPress={() => router.push(`/task/${task._id}`)} />;
}
