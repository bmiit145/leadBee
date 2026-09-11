import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../src/stores/auth.store';
import { leadService } from '../../src/services/lead.service';
import { taskService } from '../../src/services/task.service';
import { meetingService } from '../../src/services/meeting.service';
import { queryKeys } from '../../src/lib/queryKeys';
import { ScreenHeader, ListCard, ListRow } from '../../src/components/ui';
import { useViewModeSwitch } from '../../src/components/ViewModeSwitch';
import { formatDate, localeTag, toTitleCase } from '../../src/utils/format';
import { colors, spacing, borderRadius, shadows } from '../../src/theme';

const STATS_STALE_MS = 60_000;

export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, organization, logout, reloadSession, isOrganizer, hasPermission } = useAuth();

  const [refreshing, setRefreshing] = useState(false);

  // Same key and fetcher as the home screen, so both share one cached request.
  const leadStats = useQuery({
    queryKey: ['leads-home-stats'],
    queryFn: () => leadService.getDashboardStats(),
    staleTime: STATS_STALE_MS,
  });

  const taskStats = useQuery({
    queryKey: queryKeys.tasks.statusCounts,
    queryFn: () => taskService.getStats(),
    staleTime: STATS_STALE_MS,
  });

  // The meeting list is permission-gated server-side. Asking without the grant
  // would only earn a 403, so the tile stays blank instead.
  const canViewMeetings = hasPermission('meetings.view');
  const meetingTotal = useQuery({
    // Nested under the meetings key so a meeting mutation's invalidation
    // refreshes this count too.
    queryKey: [...queryKeys.meetings.all, 'total'],
    queryFn: async () => (await meetingService.getAll({ limit: 1 })).total,
    staleTime: STATS_STALE_MS,
    enabled: canViewMeetings,
  });

  // Organizer/agent switch lives in the top bar; the hook renders nothing for
  // an agent, who has only one view.
  const viewSwitch = useViewModeSwitch();

  if (!user) return null;

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        leadStats.refetch(),
        taskStats.refetch(),
        canViewMeetings ? meetingTotal.refetch() : Promise.resolve(),
        // A failed re-read on a bad network keeps the cached profile; it must
        // never end the session.
        reloadSession().catch(() => undefined),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(t('profile.logoutConfirmTitle'), t('profile.logoutConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.logout'),
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const statValue = (value: number | undefined) =>
    value === undefined ? '–' : value.toLocaleString(localeTag());

  // Plan banner, derived from the tenant record. Display only: the app never
  // branches on the plan key itself — capability comes from `features`.
  let planTitle: string | undefined;
  let planSubtitle: string | undefined;
  if (organization) {
    const plan = toTitleCase(organization.plan);
    // -1 is unlimited. 0 is what the legacy mirror writes when no seat limit is
    // configured (entitlements/resolver.ts), so "1 of 0" would misstate it —
    // show the headcount on its own instead.
    const { maxUsers } = organization.limits;
    const used = organization.usage.users;
    const seats =
      maxUsers < 0
        ? t('profile.planSeatsUnlimited')
        : maxUsers === 0
          ? t('profile.planSeatsCount', { used: used.toLocaleString(localeTag()) })
          : t('profile.planSeats', { used, max: maxUsers });

    if (organization.status === 'trialing') {
      planTitle = t('profile.planTrial', { plan });
      const endsOn = formatDate(organization.trialEndsAt, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      planSubtitle = endsOn ? t('profile.planTrialEnds', { date: endsOn }) : seats;
    } else {
      planTitle = t('profile.planActive', { plan });
      planSubtitle = organization.status === 'past_due' ? t('profile.planPastDue') : seats;
    }
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={t('profile.title')}
        leading="none"
        actions={viewSwitch.headerAction ? [viewSwitch.headerAction] : []}
      />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(spacing.xl, insets.bottom + spacing.lg) },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <View style={styles.profileCard}>
          <View style={styles.identityRow}>
            <View style={styles.identityText}>
              <Text style={styles.name} numberOfLines={1}>
                {user.name}
              </Text>
              {organization ? (
                <Text style={styles.orgName} numberOfLines={1}>
                  {organization.name}
                </Text>
              ) : null}
            </View>
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>
                {isOrganizer ? t('profile.organizer') : t('profile.agent')}
              </Text>
            </View>
          </View>

          <View style={styles.statsRow}>
            <StatTile value={statValue(leadStats.data?.total)} label={t('profile.statLeads')} />
            <StatTile value={statValue(taskStats.data?.total)} label={t('profile.statTasks')} />
            <StatTile value={statValue(meetingTotal.data)} label={t('profile.statMeetings')} />
          </View>

          {planTitle ? (
            <View style={styles.planBanner}>
              <View style={styles.planIcon}>
                <Ionicons name="star" size={18} color="#FFFFFF" />
              </View>
              <View style={styles.planTextWrap}>
                <Text style={styles.planTitle} numberOfLines={1}>
                  {planTitle}
                </Text>
                {planSubtitle ? (
                  <Text style={styles.planSubtitle} numberOfLines={1}>
                    {planSubtitle}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : null}
        </View>

        <ListCard>
          <ListRow
            icon="person-outline"
            title={t('profile.editProfile')}
            onPress={() => router.push('/account/edit')}
          />
          <ListRow
            icon="business-outline"
            title={t('profile.myCompany')}
            onPress={() => router.push('/account/company')}
          />
          <ListRow
            icon="settings-outline"
            title={t('profile.settings')}
            onPress={() => router.push('/account/settings')}
          />
          <ListRow
            icon="log-out-outline"
            title={t('common.logout')}
            tone="danger"
            onPress={handleLogout}
            isLast
          />
        </ListCard>

        <View style={styles.footer}>
          <Text style={styles.footerText}>LeadBee</Text>
          <Text style={styles.footerCopyright}>Lead management, done properly.</Text>
        </View>
      </ScrollView>

      {viewSwitch.dialog}
    </View>
  );
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.md, paddingTop: spacing.lg },
  profileCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xxl,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.md,
  },
  identityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  identityText: { flex: 1 },
  name: { fontSize: 24, fontWeight: '700', color: colors.text },
  orgName: { fontSize: 15, color: colors.textSecondary, marginTop: 2 },
  roleBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    marginTop: 4,
  },
  roleText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.4 },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  statTile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.surfaceVariant,
  },
  statValue: { fontSize: 22, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  planBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: borderRadius.xxl,
    backgroundColor: colors.primary,
  },
  planIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  planTextWrap: { flex: 1 },
  planTitle: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  planSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  footer: { alignItems: 'center', paddingVertical: spacing.lg },
  footerText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  footerCopyright: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 2,
    opacity: 0.7,
  },
});
