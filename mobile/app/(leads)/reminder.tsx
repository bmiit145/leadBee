import React, { useState } from 'react';
import { View } from 'react-native';
import { ReminderScreen } from '../../src/screens/ReminderScreen';
import { LeadDrawer } from '../../src/components/LeadDrawer';

/** Reminder as a tab inside the Lead module — the header's hamburger opens
 *  the Lead drawer rather than popping the stack. */
export default function ReminderTab() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <View style={{ flex: 1 }}>
      <ReminderScreen leading="menu" onLeadingPress={() => setDrawerOpen(true)} />
      <LeadDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </View>
  );
}
