import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { colors, spacing, borderRadius } from '../../src/theme';
import { callService, type CallDirection } from '../../src/services/call.service';
import { queryKeys } from '../../src/lib/queryKeys';
import { MemberFilter } from '../../src/components/MemberFilter';
import { ScreenHeader, EmptyState, Avatar, CalendarPickerModal } from '../../src/components/ui';
import {
  EMPTY_RANGE,
  toDayParam,
  type DateRangeValue,
} from '../../src/components/WorkFilterSheet';
import { talkTime } from './index';

type Range = 'today' | 'yesterday' | 'last7' | 'last30' | 'custom';

const RANGES: Range[] = ['today', 'yesterday', 'last7', 'last30', 'custom'];

const DIRECTIONS: CallDirection[] = ['incoming', 'outgoing', 'missed', 'rejected'];

const DIRECTION_ICON: Record<CallDirection, keyof typeof Ionicons.glyphMap> = {
  incoming: 'arrow-down-outline',
  outgoing: 'arrow-up-outline',
  missed: 'close-circle-outline',
  rejected: 'remove-circle-outline',
};

/** `YYYY-MM-DD` of a day as the person sees it; the API reads it in their zone. */
function dayParam(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function rangeDates(range: Range): { dateFrom: string; dateTo: string } {
  const today = new Date();
  const start = new Date(today);
  if (range === 'yesterday') start.setDate(today.getDate() - 1);
  if (range === 'last7') start.setDate(today.getDate() - 6);
  if (range === 'last30') start.setDate(today.getDate() - 29);
  const end = range === 'yesterday' ? start : today;
  return { dateFrom: dayParam(start), dateTo: dayParam(end) };
}

export default function CallAnalyticsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [range, setRange] = useState<Range>('today');
  const [memberId, setMemberId] = useState<string | null>(null);
  const [custom, setCustom] = useState<DateRangeValue>(EMPTY_RANGE);
  const [pickerOpen, setPickerOpen] = useState(false);

  const filters = useMemo(() => {
    const dates =
      range === 'custom' && custom.start && custom.end
        ? { dateFrom: toDayParam(custom.start)!, dateTo: toDayParam(custom.end)! }
        : rangeDates(range === 'custom' ? 'today' : range);
    return { ...dates, calledBy: memberId ?? undefined };
  }, [range, custom, memberId]);

  const stats = useQuery({
    queryKey: [...queryKeys.calls.all, 'stats', filters],
    queryFn: () => callService.getStats(filters),
  });

  const daily = useQuery({
    queryKey: [...queryKeys.calls.all, 'daily', filters],
    queryFn: () => callService.getDaily(filters),
  });

  const activity = useQuery({
    queryKey: [...queryKeys.calls.all, 'activity', filters],
    queryFn: () => callService.getActivity(filters),
  });

  const busiest = Math.max(1, ...(daily.data ?? []).map((day) => day.calls));
  const total = stats.data?.total;

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t('calls.analytics.title')} />

      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + 24, gap: spacing.md }}>
        <MemberFilter value={memberId} onChange={setMemberId} />

        <View style={styles.rangeRow}>
          {RANGES.map((value) => (
            <TouchableOpacity
              key={value}
              style={[styles.range, range === value && styles.rangeActive]}
              onPress={() => {
                setRange(value);
                if (value === 'custom') setPickerOpen(true);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: range === value }}
            >
              <Text style={[styles.rangeText, range === value && styles.rangeTextActive]}>
                {t(`calls.ranges.${value}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {stats.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
        ) : (
          <>
            <View style={styles.headline}>
              <View style={styles.headlineHalf}>
                <Text style={styles.headlineValue}>{total?.calls ?? 0}</Text>
                <Text style={styles.headlineLabel}>{t('calls.analytics.calls')}</Text>
              </View>
              <View style={styles.headlineDivider} />
              <View style={styles.headlineHalf}>
                <Text style={styles.headlineValue}>{talkTime(total?.seconds ?? 0)}</Text>
                <Text style={styles.headlineLabel}>{t('calls.analytics.talkTime')}</Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('calls.analytics.byDirection')}</Text>
              {DIRECTIONS.map((direction) => {
                const value = stats.data?.byDirection?.[direction];
                const share = total?.calls ? ((value?.calls ?? 0) / total.calls) * 100 : 0;
                return (
                  <View key={direction} style={styles.breakdownRow}>
                    <Ionicons name={DIRECTION_ICON[direction]} size={15} color={colors.textSecondary} />
                    <Text style={styles.breakdownLabel}>{t(`calls.tabs.${direction}`)}</Text>
                    <View style={styles.breakdownTrack}>
                      <View style={[styles.breakdownFill, { width: `${share}%` }]} />
                    </View>
                    <Text style={styles.breakdownValue}>{value?.calls ?? 0}</Text>
                  </View>
                );
              })}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('calls.analytics.perDay')}</Text>
              {(daily.data ?? []).length === 0 ? (
                <EmptyState
                  icon="bar-chart-outline"
                  title={t('calls.analytics.noData')}
                  message={t('calls.analytics.noDataMessage')}
                />
              ) : (
                <View style={styles.chart}>
                  {(daily.data ?? []).map((day) => (
                    <View key={day.day} style={styles.bar}>
                      <Text style={styles.barValue}>{day.calls}</Text>
                      <View style={[styles.barFill, { height: Math.max(4, (day.calls / busiest) * 90) }]} />
                      <Text style={styles.barLabel}>{day.day.slice(8)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Who is calling, and who is being called — the questions a manager
                actually opens this screen to answer. */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('calls.analytics.topCallers')}</Text>
              {(activity.data?.byMember ?? []).length === 0 ? (
                <Text style={styles.none}>{t('calls.analytics.noData')}</Text>
              ) : (
                (activity.data?.byMember ?? []).map((member) => (
                  <View key={member.userId} style={styles.activityRow}>
                    <Avatar name={member.name} size={30} variant="solid" />
                    <Text style={styles.activityName} numberOfLines={1}>
                      {member.name}
                    </Text>
                    <Text style={styles.activityMeta}>{talkTime(member.seconds)}</Text>
                    <Text style={styles.activityCount}>{member.calls}</Text>
                  </View>
                ))
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('calls.analytics.topCustomers')}</Text>
              {(activity.data?.byLead ?? []).length === 0 ? (
                <Text style={styles.none}>{t('calls.analytics.noData')}</Text>
              ) : (
                (activity.data?.byLead ?? []).map((lead) => (
                  <TouchableOpacity
                    key={lead.leadId}
                    style={styles.activityRow}
                    onPress={() => router.push(`/lead/${lead.leadId}`)}
                    accessibilityRole="button"
                  >
                    <Avatar name={lead.name} size={30} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.activityName} numberOfLines={1}>
                        {lead.name}
                      </Text>
                      {lead.phone ? <Text style={styles.activityPhone}>{lead.phone}</Text> : null}
                    </View>
                    <Text style={styles.activityMeta}>{talkTime(lead.seconds)}</Text>
                    <Text style={styles.activityCount}>{lead.calls}</Text>
                  </TouchableOpacity>
                ))
              )}
            </View>

            <Text style={styles.basis}>{t('calls.analytics.basis')}</Text>
          </>
        )}
      </ScrollView>

      <CalendarPickerModal
        visible={pickerOpen}
        onDismiss={() => setPickerOpen(false)}
        title={t('calls.analytics.customRange')}
        mode="range"
        value={custom}
        onApply={(value) => setCustom(value)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  rangeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  range: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.surface,
  },
  rangeActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  rangeText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  rangeTextActive: { color: '#FFFFFF' },
  headline: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
    paddingVertical: spacing.lg,
  },
  headlineHalf: { flex: 1, alignItems: 'center', gap: 4 },
  headlineDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: '#FFFFFF40' },
  headlineValue: { fontSize: 24, fontWeight: '800', color: '#FFFFFF' },
  headlineLabel: { fontSize: 12.5, color: '#FFFFFFAA' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 10,
  },
  cardTitle: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  breakdownLabel: { width: 72, fontSize: 12.5, color: colors.textSecondary },
  breakdownTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.background, overflow: 'hidden' },
  breakdownFill: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
  breakdownValue: { width: 34, textAlign: 'right', fontSize: 13, fontWeight: '700', color: colors.text },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingTop: 4 },
  bar: { flex: 1, alignItems: 'center', gap: 4 },
  barValue: { fontSize: 10.5, color: colors.textSecondary },
  barFill: { width: '70%', borderRadius: 4, backgroundColor: colors.primary },
  barLabel: { fontSize: 10.5, color: colors.textSecondary },
  basis: { fontSize: 12, color: colors.textSecondary, textAlign: 'center', lineHeight: 17 },
  none: { fontSize: 13, color: colors.textSecondary, paddingVertical: 4 },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  activityName: { flex: 1, fontSize: 13.5, fontWeight: '600', color: colors.text },
  activityPhone: { fontSize: 11.5, color: colors.textSecondary },
  activityMeta: { fontSize: 12, color: colors.textSecondary },
  activityCount: { width: 32, textAlign: 'right', fontSize: 14, fontWeight: '800', color: colors.text },
});
