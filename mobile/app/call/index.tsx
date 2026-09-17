import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { colors, spacing, borderRadius } from '../../src/theme';
import { callService, type CallDirection } from '../../src/services/call.service';
import { callTracking } from '../../src/services/callTracking';
import { queryKeys } from '../../src/lib/queryKeys';
import { CallLog } from '../../src/types';
import { MemberFilter } from '../../src/components/MemberFilter';
import { ScreenHeader, SearchBar, FilterTabs, EmptyState, Avatar } from '../../src/components/ui';
import type { HeaderAction } from '../../src/components/ui';
import {
  ActiveFilterChips,
  EMPTY_RANGE,
  WorkFilterSheet,
  rangeLabel,
  toDayParam,
  type DateRangeValue,
} from '../../src/components/WorkFilterSheet';
import { useDebouncedValue } from '../../src/hooks/useDebouncedValue';

type Tab = 'all' | CallDirection;

const TABS: Tab[] = ['all', 'incoming', 'outgoing', 'missed', 'rejected'];

const DIRECTION_ICON: Record<CallDirection, keyof typeof Ionicons.glyphMap> = {
  incoming: 'arrow-down-outline',
  outgoing: 'arrow-up-outline',
  missed: 'close-circle-outline',
  rejected: 'remove-circle-outline',
};

/** Seconds as talk time reads: "0m", "4m 05s", "1h 12m". */
export function talkTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export default function CallTrackingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const [tab, setTab] = useState<Tab>('all');
  const [memberId, setMemberId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim());
  const [consented, setConsented] = useState<boolean | null>(null);
  const [range, setRange] = useState<DateRangeValue>(EMPTY_RANGE);
  const [filterOpen, setFilterOpen] = useState(false);

  // Checked on every visit: the permission can be turned off in Android
  // settings while the app is open, and then this screen is telling a lie.
  useFocusEffect(
    React.useCallback(() => {
      let alive = true;
      void (async () => {
        const consent = await callTracking.getConsent();
        const ready = Boolean(consent) && callTracking.hasPermission();
        if (alive) setConsented(ready);
        // Opening this screen is the moment the numbers are expected to be
        // current, so it is also when new calls are picked up.
        if (ready) void callTracking.sync();
      })();
      return () => {
        alive = false;
      };
    }, [])
  );

  const filters = useMemo(
    () => ({
      calledBy: memberId ?? undefined,
      search: search || undefined,
      dateFrom: toDayParam(range.start),
      dateTo: toDayParam(range.end),
    }),
    [memberId, search, range]
  );

  const calls = useQuery({
    queryKey: [...queryKeys.calls.all, 'list', tab, filters],
    queryFn: () =>
      callService.getAll({ ...filters, ...(tab === 'all' ? {} : { direction: tab }), limit: 50 }),
  });

  const stats = useQuery({
    queryKey: [...queryKeys.calls.all, 'stats', filters],
    queryFn: () => callService.getStats(filters),
  });

  const counters: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'all', label: t('calls.tabs.all'), icon: 'call-outline' },
    ...TABS.filter((key): key is CallDirection => key !== 'all').map((key) => ({
      key: key as Tab,
      label: t(`calls.tabs.${key}`),
      icon: DIRECTION_ICON[key],
    })),
  ];

  const countFor = (key: Tab) =>
    key === 'all' ? stats.data?.total : stats.data?.byDirection?.[key as CallDirection];

  const actions: HeaderAction[] = [
    {
      icon: 'bar-chart-outline',
      accessibilityLabel: t('calls.analytics.open'),
      onPress: () => router.push('/call/analytics'),
    },
  ];

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t('calls.title')} actions={actions} />

      {consented === false ? (
        <View style={styles.consentPrompt}>
          <Ionicons name="lock-closed-outline" size={18} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.consentTitle}>{t('calls.needsConsent.title')}</Text>
            <Text style={styles.consentBody}>{t('calls.needsConsent.body')}</Text>
          </View>
          <TouchableOpacity
            style={styles.consentBtn}
            onPress={() => router.push('/call/consent')}
            accessibilityRole="button"
          >
            <Text style={styles.consentBtnText}>{t('calls.needsConsent.action')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.controls}>
        <MemberFilter value={memberId} onChange={setMemberId} />
        <SearchBar
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder={t('calls.searchPlaceholder')}
          onFilterPress={() => setFilterOpen(true)}
          filterCount={range.start ? 1 : 0}
        />
        <ActiveFilterChips
          filters={
            range.start
              ? [{ key: 'range', label: rangeLabel(range) ?? '', onRemove: () => setRange(EMPTY_RANGE) }]
              : []
          }
          onClearAll={() => setRange(EMPTY_RANGE)}
        />
      </View>

      {/* Scrolls sideways so every direction keeps a readable card, as more are added. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.counterRow}>
        {counters.map((counter) => {
          const value = countFor(counter.key);
          return (
            <TouchableOpacity
              key={counter.key}
              style={[styles.counter, tab === counter.key && styles.counterActive]}
              onPress={() => setTab(counter.key)}
              accessibilityRole="button"
            >
              <View style={styles.counterTop}>
                <Ionicons name={counter.icon} size={15} color={colors.primary} />
                <Text style={styles.counterValue}>{value ? value.calls : 0}</Text>
              </View>
              <Text style={styles.counterLabel} numberOfLines={1}>
                {counter.label}
              </Text>
              <Text style={styles.counterTime}>{talkTime(value?.seconds ?? 0)}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <FilterTabs
        tabs={TABS.map((value) => ({ value, label: t(`calls.tabs.${value}`) }))}
        value={tab}
        onChange={setTab}
        padCounts={false}
      />

      {calls.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={calls.data?.data ?? []}
          keyExtractor={(item: CallLog) => item._id}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + 24 }}
          refreshing={calls.isRefetching}
          onRefresh={() => {
            void calls.refetch();
            void stats.refetch();
          }}
          renderItem={({ item }) => <CallRow call={item} onPress={(leadId) => router.push(`/lead/${leadId}`)} />}
          ListEmptyComponent={
            <EmptyState
              icon="call-outline"
              title={t('calls.empty.title')}
              message={consented === false ? t('calls.empty.noConsent') : t('calls.empty.message')}
            />
          }
        />
      )}

      <WorkFilterSheet
        visible={filterOpen}
        onDismiss={() => setFilterOpen(false)}
        range={range}
        choices={{}}
        sections={[]}
        onApply={({ range: next }) => setRange(next)}
      />
    </View>
  );
}

function CallRow({ call, onPress }: { call: CallLog; onPress: (leadId: string) => void }) {
  const { t } = useTranslation();
  const lead = typeof call.leadId === 'object' ? call.leadId : null;
  const direction = call.direction ?? 'outgoing';

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => lead && onPress(lead._id)}
      disabled={!lead}
      activeOpacity={0.75}
      accessibilityRole="button"
    >
      <Avatar name={lead?.contactName} size={40} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName} numberOfLines={1}>
          {lead?.contactName ?? call.phoneNumber ?? t('calls.unknownNumber')}
        </Text>
        <View style={styles.rowMeta}>
          <Ionicons name={DIRECTION_ICON[direction]} size={13} color={colors.textSecondary} />
          <Text style={styles.rowMetaText}>{t(`calls.tabs.${direction}`)}</Text>
          {call.duration ? <Text style={styles.rowMetaText}>· {talkTime(call.duration)}</Text> : null}
          <Text style={styles.rowMetaText}>· {call.calledByName}</Text>
        </View>
      </View>
      <Text style={styles.rowTime}>
        {new Date(call.calledAt).toLocaleString('en-IN', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  controls: { padding: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
  consentPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    margin: spacing.md,
    marginBottom: 0,
    padding: spacing.md,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  consentTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  consentBody: { fontSize: 12.5, color: colors.textSecondary, marginTop: 2 },
  consentBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  consentBtnText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  counterRow: { gap: 8, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  counter: {
    width: 116,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: 10,
    gap: 2,
  },
  counterActive: { borderColor: colors.primary, borderWidth: 1.5 },
  counterTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  counterValue: { fontSize: 16, fontWeight: '800', color: colors.text },
  counterLabel: { fontSize: 11.5, fontWeight: '700', color: colors.text, marginTop: 4 },
  counterTime: { fontSize: 10.5, color: colors.textSecondary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: 10,
  },
  rowName: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, flexWrap: 'wrap' },
  rowMetaText: { fontSize: 12, color: colors.textSecondary },
  rowTime: { fontSize: 11.5, color: colors.textSecondary },
});
