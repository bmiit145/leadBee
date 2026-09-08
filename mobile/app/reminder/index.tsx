import React from 'react';
import { ReminderScreen } from '../../src/screens/ReminderScreen';

/** Reminder reached as a pushed screen (from the Lead drawer or a deep link). */
export default function ReminderRoute() {
  return <ReminderScreen leading="back" />;
}
