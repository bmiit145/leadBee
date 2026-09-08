import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { colors, spacing, borderRadius } from '../../src/theme';
import { leadService } from '../../src/services/lead.service';
import { meetingService } from '../../src/services/meeting.service';
import { taskService } from '../../src/services/task.service';
import { ScreenHeader, BottomSheet } from '../../src/components/ui';
import { LeadDrawer } from '../../src/components/LeadDrawer';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const KINDS = [
  { key: 'leads' as const, label: 'Leads', color: '#2F7FD0', icon: 'person-add', tint: '#E3F2FD' },
  { key: 'meetings' as const, label: 'Meetings', color: '#F4622E', icon: 'people-circle', tint: '#FFECE4' },
  { key: 'tasks' as const, label: 'Tasks', color: '#1F2933', icon: 'checkmark-circle', tint: '#ECEEF0' },
];

type Counts = { leads: number; meetings: number; tasks: number };

function dayKey(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
}

function sameDay(a: Date, b: Date) {
  return dayKey(a) === dayKey(b);
}

/**
 * Month calendar for the Lead module: per-day activity counts for leads,
 * meetings and tasks, with a day sheet showing the breakdown.
 *
 * Counts are grouped client-side from the three list endpoints for the visible
 * month rather than adding a bespoke aggregate endpoint — the volumes here are
 * a single user's month, so one request each is cheaper than new server code.
 */
export default function CalendarTab() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState<Date | null>(null);

  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const from = monthStart.toISOString();
  const to = monthEnd.toISOString();
  const monthId = `${cursor.getFullYear()}-${cursor.getMonth()}`;

  const leads = useQuery({
    queryKey: ['cal-leads', monthId],
    queryFn: () => leadService.getAll({ dateFrom: from, dateTo: to, limit: 100 }),
  });
  const meetings = useQuery({
    queryKey: ['cal-meetings', monthId],
    queryFn: () => meetingService.getAll({ dateFrom: from, dateTo: to, limit: 100 }),
  });
  const tasks = useQuery({
    queryKey: ['cal-tasks', monthId],
    queryFn: () => taskService.getAll({ dateFrom: from, dateTo: to, limit: 100 }),
  });

  const isLoading = leads.isLoading || meetings.isLoading || tasks.isLoading;

  /** day-key -> counts, built once per data change. */
  const byDay = useMemo(() => {
    const map: Record<string, Counts> = {};
    const bump = (k: string, field: keyof Counts) => {
      map[k] = map[k] ?? { leads: 0, meetings: 0, tasks: 0 };
      map[k][field] += 1;
    };
    (leads.data?.data ?? []).forEach((l) => bump(dayKey(l.createdAt), 'leads'));
    (meetings.data?.data ?? []).forEach((m) => bump(dayKey(m.scheduledAt), 'meetings'));
    (tasks.data?.data ?? []).forEach((t) => bump(dayKey(t.endDate), 'tasks'));
    return map;
  }, [leads.data, meetings.data, tasks.data]);

  const monthTotals: Counts = useMemo(
    () => ({
      leads: leads.data?.total ?? 0,
      meetings: meetings.data?.total ?? 0,
      tasks: tasks.data?.total ?? 0,
    }),
    [leads.data, meetings.data, tasks.data]
  );

  const days = useMemo(() => {
    const startOffset = monthStart.getDay();
    const gridStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - startOffset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [cursor, monthStart]);

  const selectedCounts: Counts = selected
    ? byDay[dayKey(selected)] ?? { leads: 0, meetings: 0, tasks: 0 }
    : { leads: 0, meetings: 0, tasks: 0 };
  const selectedTotal = selectedCounts.leads + selectedCounts.meetings + selectedCounts.tasks;

  const shiftMonth = (delta: number) =>
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Calendar"
        leading="menu"
        onLeadingPress={() => setDrawerOpen(true)}
        actions={[{ icon: 'notifications-outline', onPress: () => {}, accessibilityLabel: 'Notifications' }]}
      />

      <ScrollView contentContainerStyle={{ padding: spacing.md }}>
        <View style={styles.monthRow}>
          <TouchableOpacity style={styles.navBtn} onPress={() => shiftMonth(-1)} accessibilityLabel="Previous month">
            <Ionicons name="chevron-back" size={18} color={colors.primary} />
          </TouchableOpacity>
          <Text style={styles.monthLabel}>
            {cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </Text>
          <TouchableOpacity style={styles.navBtn} onPress={() => shiftMonth(1)} accessibilityLabel="Next month">
            <Ionicons name="chevron-forward" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.statsCard}>
          {KINDS.map((k, i) => (
            <React.Fragment key={k.key}>
              {i > 0 ? <View style={styles.statDivider} /> : null}
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: k.color }]}>{monthTotals[k.key]}</Text>
                <Text style={styles.statLabel}>{k.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>

        <View style={styles.weekRow}>
          {WEEKDAYS.map((w, i) => (
            <Text key={w} style={[styles.weekLabel, i === 0 && styles.sunday]}>{w}</Text>
          ))}
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : (
          <View style={styles.grid}>
            {days.map((d) => {
              const outside = d.getMonth() !== cursor.getMonth();
              const counts = byDay[dayKey(d)];
              const isToday = sameDay(d, today);
              return (
                <TouchableOpacity
                  key={d.toISOString()}
                  style={styles.cell}
                  disabled={outside}
                  onPress={() => setSelected(d)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.dayNum, isToday && styles.dayNumToday]}>
                    <Text
                      style={[
                        styles.dayText,
                        d.getDay() === 0 && styles.sunday,
                        outside && styles.dayTextMuted,
                        isToday && styles.dayTextToday,
                      ]}
                    >
                      {d.getDate()}
                    </Text>
                  </View>
                  {!outside && counts ? (
                    <View style={styles.countStack}>
                      {KINDS.map((k) =>
                        counts[k.key] > 0 ? (
                          <Text key={k.key} style={[styles.countText, { color: k.color }]}>
                            {counts[k.key]}
                          </Text>
                        ) : null
                      )}
                    </View>
                  ) : (
                    <View style={styles.countStack} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <View style={styles.legendRow}>
          {KINDS.map((k) => (
            <View key={k.key} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: k.color }]} />
              <Text style={styles.legendText}>{k.label}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <BottomSheet visible={!!selected} onDismiss={() => setSelected(null)} maxHeightRatio={0.5}>
        {selected ? (
          <>
            <Text style={styles.sheetTitle}>
              {selected.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </Text>
            {KINDS.map((k) => (
              <View key={k.key} style={styles.sheetRow}>
                <View style={[styles.sheetIcon, { backgroundColor: k.tint }]}>
                  <Ionicons name={k.icon as any} size={19} color={k.color} />
                </View>
                <Text style={styles.sheetLabel}>{k.label}</Text>
                <Text style={[styles.sheetCount, { color: k.color }]}>{selectedCounts[k.key]}</Text>
              </View>
            ))}
            <View style={styles.sheetDivider} />
            <View style={styles.sheetRow}>
              <Text style={styles.sheetTotalLabel}>Total Activities</Text>
              <Text style={styles.sheetTotalValue}>{selectedTotal}</Text>
            </View>
          </>
        ) : null}
      </BottomSheet>

      <LeadDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </View>
  );
}

const CELL = `${100 / 7}%`;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.lg, marginBottom: spacing.md },
  navBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: `${colors.primary}14`, alignItems: 'center', justifyContent: 'center' },
  monthLabel: { fontSize: 17, fontWeight: '700', color: colors.text, minWidth: 150, textAlign: 'center' },
  statsCard: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  stat: { flex: 1, alignItems: 'center' },
  statDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  statValue: { fontSize: 20, fontWeight: '800' },
  statLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  weekRow: { flexDirection: 'row' },
  weekLabel: { width: CELL, textAlign: 'center', fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginBottom: 6 },
  sunday: { color: '#E04A3F' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: CELL, alignItems: 'center', paddingVertical: 6, minHeight: 58 },
  dayNum: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  dayNumToday: { backgroundColor: colors.primary },
  dayText: { fontSize: 14, fontWeight: '600', color: colors.text },
  dayTextMuted: { color: colors.textDisabled },
  dayTextToday: { color: '#FFFFFF', fontWeight: '800' },
  countStack: { minHeight: 18, alignItems: 'center' },
  countText: { fontSize: 10.5, fontWeight: '800', lineHeight: 13 },
  legendRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg, marginTop: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 4.5 },
  legendText: { fontSize: 12.5, color: colors.textSecondary, fontWeight: '600' },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10 },
  sheetIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sheetLabel: { flex: 1, fontSize: 15, color: colors.textSecondary },
  sheetCount: { fontSize: 17, fontWeight: '800' },
  sheetDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.xs },
  sheetTotalLabel: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
  sheetTotalValue: { fontSize: 17, fontWeight: '800', color: colors.text },
});
