import type { TaskStatus, MeetingType, MeetingStatus } from '../types';

export const TASK_STATUS_META: Record<TaskStatus, { label: string; color: string }> = {
  pending:     { label: 'Pending',     color: '#5B6B78' },
  in_progress: { label: 'In Progress', color: '#1B7A9E' },
  on_hold:     { label: 'On Hold',     color: '#C2731F' },
  in_review:   { label: 'In Review',   color: '#7B61C9' },
  completed:   { label: 'Completed',   color: '#2C7A57' },
};

export const TASK_STATUS_ORDER: TaskStatus[] = [
  'pending', 'in_progress', 'on_hold', 'in_review', 'completed',
];

export const MEETING_TYPE_META: Record<MeetingType, { label: string; icon: string }> = {
  office_visit:  { label: 'Office Visit',  icon: 'business-outline' },
  site_visit:    { label: 'Site Visit',    icon: 'location-outline' },
  client_office: { label: "Client's Office", icon: 'briefcase-outline' },
  phone_call:    { label: 'Phone Call',    icon: 'call-outline' },
  google_meet:   { label: 'Google Meet',   icon: 'videocam-outline' },
  zoom:          { label: 'Zoom Meeting',  icon: 'videocam-outline' },
};

export const MEETING_TYPE_ORDER: MeetingType[] = [
  'office_visit', 'site_visit', 'client_office', 'phone_call', 'google_meet', 'zoom',
];

export const MEETING_STATUS_META: Record<MeetingStatus, { label: string; color: string }> = {
  scheduled:   { label: 'Scheduled',   color: '#2F7FD0' },
  completed:   { label: 'Completed',   color: '#2C7A57' },
  cancelled:   { label: 'Cancelled',   color: '#BC5430' },
  rescheduled: { label: 'Rescheduled', color: '#C2731F' },
};

/** Same lead-time set the reference app offers for both meetings and lead reminders. */
export const REMINDER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'None' },
  { value: 5, label: '5 Minutes before' },
  { value: 10, label: '10 Minutes before' },
  { value: 15, label: '15 Minutes before' },
  { value: 30, label: '30 Minutes before' },
  { value: 60, label: '1 Hour before' },
  { value: 120, label: '2 Hours before' },
];

/** The duration chip row on the "Select meeting time" sheet. */
export const SLOT_DURATIONS = [
  { minutes: 120, label: '2 hours' },
  { minutes: 90, label: '1.5 hours' },
  { minutes: 60, label: '1 hour' },
  { minutes: 45, label: '45 min' },
  { minutes: 30, label: '30 min' },
];

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} Minutes`;
  const hrs = minutes / 60;
  return `${hrs % 1 === 0 ? hrs : hrs.toFixed(1)} Hour${hrs === 1 ? '' : 's'}`;
}
