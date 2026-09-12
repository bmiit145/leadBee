import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../src/stores/auth.store';
import { leadService } from '../../src/services/lead.service';
import { meetingService } from '../../src/services/meeting.service';
import { taskService } from '../../src/services/task.service';
import { LeadDashboardStats } from '../../src/types';
import { colors, spacing, borderRadius } from '../../src/theme';
import { ReminderFeedItem } from '../../src/components/ReminderFeedItem';
import { SegmentedTabs } from '../../src/components/ui';
import { LeadDrawer } from '../../src/components/LeadDrawer';
import { ViewModeSwitchButton } from '../../src/components/ViewModeSwitch';
import { NotificationBell } from '../../src/components/NotificationBell';
import { userService } from '../../src/services/user.service';
import { queryKeys } from '../../src/lib/queryKeys';
import { useTranslation } from 'react-i18next';

const HEADER_BG = '#111827';

// ─── Animated "New Leads" pill ────────────────────────────────────────────────

// "!" circle lives on the right always.
// When count > 0: pill grows LEFTWARD from the "!" position every 4-5s for 2s, then collapses back.
// Collapsed = 44px (just the red "!" circle). Expanded = 220px (text + "!" circle).
const PILL_MIN = 44;
const PILL_MAX = 188;

function useAlertPillAnim(count: number) {
  const pillWidth   = useRef(new Animated.Value(PILL_MIN)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (count === 0) {
      pillWidth.setValue(PILL_MIN);
      textOpacity.setValue(0);
      return;
    }

    let alive = true;

    const runCycle = () => {
      Animated.sequence([
        Animated.delay(4000),  // stay collapsed 4s
        // Extend leftward: text fades in as width grows
        Animated.parallel([
          Animated.timing(pillWidth,   { toValue: PILL_MAX, duration: 360, useNativeDriver: false }),
          Animated.timing(textOpacity, { toValue: 1, duration: 320, useNativeDriver: false }),
        ]),
        Animated.delay(2000),  // stay expanded 2s
        // Collapse rightward: text fades out then width shrinks
        Animated.timing(textOpacity, { toValue: 0, duration: 200, useNativeDriver: false }),
        Animated.timing(pillWidth, { toValue: PILL_MIN, duration: 300, useNativeDriver: false }),
      ]).start(() => { if (alive) runCycle(); });
    };

    runCycle();
    return () => { alive = false; };
  }, [count]);

  return { pillWidth, textOpacity };
}

// ─── Admin home ───────────────────────────────────────────────────────────────

function AdminLeadsHome({ stats }: { stats: LeadDashboardStats | undefined; userName: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { hasPermission } = useAuth();

  // Same keys as the Team, Profile and list screens, so each count is one
  // shared request rather than a second copy of it.
  const memberCount = useQuery({
    queryKey: [...queryKeys.users.all, 'count', 'active'],
    queryFn: async () => (await userService.listPage({ isActive: true, page: 1, limit: 1 })).total,
    staleTime: 60_000,
  });
  const taskStats = useQuery({
    queryKey: queryKeys.tasks.statusCounts,
    queryFn: () => taskService.getStats(),
    staleTime: 60_000,
  });
  const meetingTotal = useQuery({
    queryKey: [...queryKeys.meetings.all, 'total'],
    queryFn: async () => (await meetingService.getAll({ limit: 1 })).total,
    staleTime: 60_000,
    // Permission-gated server-side; asking without it only earns a 403.
    enabled: hasPermission('meetings.view'),
  });

  const tiles = [
    { label: 'User\nManagement',  value: memberCount.data ?? 0, icon: 'person-outline' as const,   color: '#2196F3', bg: '#E3F2FD', onPress: () => router.push('/team') },
    { label: 'Leads\nManagement', value: stats?.total ?? 0, icon: 'people-outline' as const, color: '#4CAF50', bg: '#E8F5E9', onPress: () => router.push('/lead/list') },
    { label: 'Task\nManagement',  value: taskStats.data?.total ?? 0, icon: 'clipboard-outline' as const, color: '#9C27B0', bg: '#F3E5F5', onPress: () => router.push('/task/list') },
    { label: 'Meeting\nManagement', value: meetingTotal.data ?? 0, icon: 'people-circle-outline' as const, color: '#FF9800', bg: '#FFF3E0', onPress: () => router.push('/meeting/list') },
  ];

  const otherOptions = [
    { label: 'Service Create', subtitle: 'Manage purposes of inquiry', icon: 'settings-outline' as const, soon: false, onPress: () => router.push('/lead/services') },
    { label: t('home.dropTags'), subtitle: t('home.dropTagsSubtitle'), icon: 'pricetags-outline' as const, soon: false, onPress: () => router.push('/lead/drop-reasons') },
    { label: 'Attendance',     subtitle: 'Track agent attendance',     icon: 'calendar-outline' as const,  soon: true,  onPress: () => {} },
    { label: 'Target & Earning', subtitle: 'Set agent targets',        icon: 'trending-up-outline' as const, soon: false, onPress: () => {} },
    { label: 'Reports',        subtitle: 'Lead analytics & performance', icon: 'bar-chart-outline' as const, soon: true,  onPress: () => {} },
    { label: 'Announcement',   subtitle: 'Broadcast updates to agents', icon: 'megaphone-outline' as const, soon: false, onPress: () => {} },
  ];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[styles.adminHeader, { paddingTop: insets.top + 12 }]}>
        {/* Same width as the switch slot, so the title stays centred. */}
        <View style={[styles.adminHeaderSide, styles.adminHeaderSideStart]}>
          <NotificationBell style={styles.bellBtn} />
        </View>
        <Text style={styles.adminHeaderTitle}>Home</Text>
        <View style={styles.adminHeaderSide}>
          <ViewModeSwitchButton style={styles.bellBtn} />
        </View>
      </View>

      {/* Management tiles */}
      <View style={styles.tilesGrid}>
        {tiles.map(tile => (
          <TouchableOpacity
            key={tile.label}
            style={[styles.tile, { backgroundColor: colors.primary }]}
            onPress={tile.onPress}
            activeOpacity={0.85}
          >
            <View style={styles.tileTop}>
              <Text style={styles.tileValue}>{tile.value}</Text>
              <View style={[styles.tileIconWrap, { backgroundColor: tile.bg }]}>
                <Ionicons name={tile.icon} size={28} color={tile.color} />
              </View>
            </View>
            <Text style={styles.tileLabel}>{tile.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Other options */}
      <Text style={styles.sectionTitle}>OTHER OPTIONS</Text>
      <View style={styles.otherList}>
        {otherOptions.map((opt, idx) => (
          <TouchableOpacity
            key={opt.label}
            style={[styles.otherItem, idx < otherOptions.length - 1 && styles.otherItemBorder]}
            onPress={opt.onPress}
            activeOpacity={0.8}
            disabled={opt.soon}
          >
            <View style={styles.otherIconWrap}>
              <Ionicons name={opt.icon} size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.otherLabel}>{opt.label}</Text>
              <Text style={styles.otherSubtitle}>{opt.subtitle}</Text>
            </View>
            {opt.soon ? (
              <Image source={require('../../assets/logo.png')} style={{ width: 0, height: 0 }} />
            ) : null}
            {opt.soon ? (
              <View style={styles.comingSoonBadge}>
                <Text style={styles.comingSoonText}>COMING{'\n'}SOON</Text>
              </View>
            ) : (
              <Text style={styles.otherArrow}>{'>>'}</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

// ─── Today's Reminder (compact, Home version of the Reminder screen) ──────────

function TodaysReminder() {
  const router = useRouter();
  const [tab, setTab] = useState<'lead' | 'meeting' | 'task'>('lead');

  const leadsQuery = useQuery({
    queryKey: ['home-reminder-leads'],
    queryFn: () => leadService.getAll({ reminderScope: 'today', limit: 5 }),
  });
  const meetingsQuery = useQuery({
    queryKey: ['home-reminder-meetings'],
    queryFn: () => meetingService.getAll({ scope: 'today', status: 'scheduled', limit: 5 }),
  });
  const tasksQuery = useQuery({
    queryKey: ['home-reminder-tasks'],
    queryFn: () => taskService.getAll({ scope: 'today', limit: 5 }),
  });

  const counts = {
    lead: leadsQuery.data?.total ?? 0,
    meeting: meetingsQuery.data?.total ?? 0,
    task: tasksQuery.data?.total ?? 0,
  };

  const items =
    tab === 'lead' ? leadsQuery.data?.data ?? [] : tab === 'meeting' ? meetingsQuery.data?.data ?? [] : tasksQuery.data?.data ?? [];

  return (
    <View>
      <View style={styles.sectionHeader2}>
        <Text style={styles.sectionTitle2}>Today's Reminder</Text>
        <TouchableOpacity onPress={() => router.push('/reminder')}>
          <Text style={styles.viewAll}>View All</Text>
        </TouchableOpacity>
      </View>

      <SegmentedTabs
        style={{ marginHorizontal: spacing.md, marginBottom: spacing.sm }}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'lead', label: 'Lead', count: counts.lead },
          { value: 'meeting', label: 'Meeting', count: counts.meeting },
          { value: 'task', label: 'Task', count: counts.task },
        ]}
      />

      <View style={{ paddingHorizontal: spacing.md }}>
        {items.length === 0 ? (
          <Text style={styles.reminderEmptyText}>Nothing due today.</Text>
        ) : (
          items.map((item: any) => <ReminderFeedItem key={item._id} kind={tab} item={item} />)
        )}
      </View>
    </View>
  );
}

// ─── Agent home ───────────────────────────────────────────────────────────────

function AgentLeadsHome({ stats, userName }: { stats: LeadDashboardStats | undefined; userName: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const newLeadsCount = stats?.byStage.new ?? 0;
  const { pillWidth, textOpacity } = useAlertPillAnim(newLeadsCount);

  const callCards = [
    { label: 'All Calls\n(0h 0m)',  icon: 'call-outline' as const },
    { label: 'Incoming\n(0h 0m)',   icon: 'call-outline' as const },
    { label: 'Outgoing\n(0h 0m)',   icon: 'call-outline' as const },
    { label: 'Missed\n(0h 0m)',     icon: 'call-outline' as const },
  ];

  const exploreItems = [
    { label: 'Leads',   icon: 'people-outline' as const,         color: '#2196F3', bg: '#E3F2FD', soon: false, onPress: () => router.push('/lead/list') },
    { label: 'Tasks',   icon: 'clipboard-outline' as const,       color: '#9C27B0', bg: '#F3E5F5', soon: false, onPress: () => router.push('/task/list') },
    { label: 'Meeting', icon: 'people-circle-outline' as const,   color: '#FF9800', bg: '#FFF3E0', soon: false, onPress: () => router.push('/meeting/list') },
  ];

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={[styles.container, { backgroundColor: '#F5F6FA' }]}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Top bar ── */}
        <View style={[styles.agentTopBar, { paddingTop: insets.top + 10 }]}>

          {/* Hamburger — always left */}
          <TouchableOpacity style={styles.hamburger} onPress={() => setDrawerOpen(true)} activeOpacity={0.8}>
            <Ionicons name="menu" size={24} color="#fff" />
          </TouchableOpacity>

          {/* Flexible spacer — shrinks as pill grows leftward */}
          <View style={{ flex: 1 }} />

          {/* Right — pill extends LEFTWARD from "!" circle, then bell */}
          <View style={styles.topBarRight}>
            <TouchableOpacity
              onPress={() => newLeadsCount > 0 ? router.push('/lead/list') : undefined}
              activeOpacity={newLeadsCount > 0 ? 0.85 : 1}
            >
              {/* Pill grows leftward: "!" circle on LEFT (moves left), text revealed on RIGHT */}
              <Animated.View style={[styles.alertPill, { width: pillWidth }]}>
                <View style={styles.alertIconCircle}>
                  <Text style={styles.alertIconMark}>!</Text>
                </View>
                <Animated.Text
                  style={[styles.alertPillText, { opacity: textOpacity }]}
                  numberOfLines={1}
                >
                  {`New Leads (${String(newLeadsCount).padStart(2, '0')})`}
                </Animated.Text>
              </Animated.View>
            </TouchableOpacity>

            {/* Organizer previewing the agent view: the way back to admin. */}
            <ViewModeSwitchButton style={styles.bellBtn} />

            <NotificationBell style={styles.bellBtn} />
          </View>

        </View>

        {/* Profile + Target card */}
        <View style={styles.profileCard}>
          <View style={styles.profileCardLeft}>
            <Image source={require('../../assets/logo.png')} style={styles.profileLogo} resizeMode="contain" />
            <View style={styles.profileNameBox}>
              <Text style={styles.profileName}>{userName.toUpperCase()}</Text>
            </View>
          </View>
          <View style={styles.profileCardRight}>
            <View style={styles.targetRow}>
              <Text style={styles.targetTitle}>Monthly Outstanding Target</Text>
              <Text style={styles.targetValue}>₹0</Text>
              <View style={styles.progressBar}><View style={[styles.progressFill, { width: '0%', backgroundColor: '#FFD600' }]} /></View>
              <Text style={styles.archiveText}>Archive Monthly Target 0</Text>
            </View>
            <View style={[styles.targetRow, { marginTop: 8 }]}>
              <Text style={styles.targetTitle}>Daily Outstanding Target</Text>
              <Text style={[styles.targetValue, { color: colors.primary }]}>₹0</Text>
              <View style={styles.progressBar}><View style={[styles.progressFill, { width: '0%', backgroundColor: '#4CAF50' }]} /></View>
              <Text style={styles.archiveText}>Archive Daily Target 0</Text>
            </View>
          </View>
        </View>

        <TodaysReminder />

        {/* Today's Call Tracking */}
        <View style={styles.sectionHeader2}>
          <Text style={styles.sectionTitle2}>Today's Call Tracking</Text>
          <TouchableOpacity><Text style={styles.viewAll}>View All</Text></TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.md, gap: 10, paddingBottom: 4 }}>
          {callCards.map(card => (
            <View key={card.label} style={styles.callCard}>
              <View style={styles.callBadge}><Text style={styles.callBadgeText}>00</Text></View>
              <View style={styles.callIcon}><Ionicons name={card.icon} size={26} color="#90CAF9" /></View>
              <Text style={styles.callLabel}>{card.label}</Text>
            </View>
          ))}
        </ScrollView>

        {/* Create New Lead */}
        <TouchableOpacity style={styles.createLeadBtn} onPress={() => router.push('/lead/add')} activeOpacity={0.85}>
          <Ionicons name="people-outline" size={22} color="#fff" />
          <Text style={styles.createLeadBtnText}>Create New Lead</Text>
        </TouchableOpacity>

        {/* Explore */}
        <Text style={[styles.sectionTitle2, { paddingHorizontal: spacing.md, marginBottom: 10 }]}>Explore</Text>
        <View style={styles.exploreRow}>
          {exploreItems.map(item => (
            <TouchableOpacity
              key={item.label}
              style={[styles.exploreCard, { backgroundColor: item.bg }]}
              onPress={item.onPress}
              activeOpacity={item.soon ? 1 : 0.8}
              disabled={item.soon}
            >
              <View style={[styles.exploreIconWrap, { backgroundColor: item.color + '25' }]}>
                <Ionicons name={item.icon} size={30} color={item.color} />
              </View>
              <Text style={[styles.exploreLabel, { color: item.color }]}>{item.label}</Text>
              {item.soon && (
                <View style={styles.exploreSoon}><Text style={styles.exploreSoonText}>SOON</Text></View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Drawer rendered over the screen */}
      <LeadDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </View>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function LeadsHomeScreen() {
  const { user, isOrganizer, viewMode } = useAuth();
  const userName = user?.name ?? 'User';

  const { data: stats } = useQuery<LeadDashboardStats>({
    queryKey: ['leads-home-stats'],
    queryFn: () => leadService.getDashboardStats(),
    staleTime: 60_000,
  });

  // Organizer in admin viewMode → admin dashboard
  if (isOrganizer && viewMode === 'admin') {
    return <AdminLeadsHome stats={stats} userName={userName} />;
  }

  // Agent OR organizer previewing agent view
  return <AgentLeadsHome stats={stats} userName={userName} />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  // Admin header
  adminHeader: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  adminHeaderSide: { width: 44, alignItems: 'flex-end' },
  adminHeaderSideStart: { alignItems: 'flex-start' },
  adminHeaderTitle: { fontSize: 22, fontWeight: '800', color: '#fff' },

  // Tiles
  tilesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: spacing.md,
    gap: 12,
  },
  tile: {
    width: '47%',
    borderRadius: borderRadius.xl,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  tileValue: { fontSize: 36, fontWeight: '900', color: '#fff' },
  tileIconWrap: { width: 52, height: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  tileLabel: { fontSize: 15, fontWeight: '700', color: '#fff', lineHeight: 20 },

  // Other options
  sectionTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.text,
    paddingHorizontal: spacing.md,
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  otherList: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  otherItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16, gap: 14 },
  otherItemBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderLight ?? '#F0F0F0' },
  otherIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary + '15', justifyContent: 'center', alignItems: 'center' },
  otherLabel: { fontSize: 15, fontWeight: '700', color: colors.text },
  otherSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  otherArrow: { fontSize: 14, fontWeight: '800', color: colors.primary },
  comingSoonBadge: { backgroundColor: '#FEE2E2', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, alignItems: 'center' },
  comingSoonText: { fontSize: 9, fontWeight: '800', color: '#EF4444', textAlign: 'center', lineHeight: 12 },

  // Agent top bar
  agentTopBar: {
    backgroundColor: HEADER_BG,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  hamburger: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center', alignItems: 'center',
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bellBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center', alignItems: 'center',
  },
  // Pill grows leftward (right edge anchored). "!" circle on LEFT moves left, text revealed right.
  // Collapsed = 44px: pink pill with red "!" circle inside (pink halo). Expanded = full text.
  alertPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    borderRadius: 22,
    height: 44,
    overflow: 'hidden',       // clips text as pill shrinks
  },
  alertIconCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#EF4444',
    justifyContent: 'center', alignItems: 'center',
    marginLeft: 4,            // pink halo on the left of the red circle
    flexShrink: 0,
  },
  alertIconMark: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 23,
    textAlign: 'center',
    includeFontPadding: false,
  },
  alertPillText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#EF4444',
    paddingHorizontal: 10,
  },

  // Profile card
  profileCard: {
    marginHorizontal: spacing.md,
    marginTop: 14,
    marginBottom: 14,
    backgroundColor: '#fff',
    borderRadius: borderRadius.xl,
    flexDirection: 'row',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  profileCardLeft: {
    width: '38%',
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    gap: 8,
  },
  profileLogo: { width: 70, height: 35 },
  profileNameBox: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  profileName: { fontSize: 11, fontWeight: '900', color: '#fff', textAlign: 'center', lineHeight: 14 },
  profileCardRight: { flex: 1, padding: 12 },
  targetRow: {},
  targetTitle: { fontSize: 11, color: colors.textSecondary, fontWeight: '500' },
  targetValue: { fontSize: 18, fontWeight: '900', color: '#333', marginVertical: 2 },
  progressBar: { height: 6, backgroundColor: '#E0E0E0', borderRadius: 3, overflow: 'hidden', marginVertical: 3 },
  progressFill: { height: 6, borderRadius: 3 },
  archiveText: { fontSize: 10, color: colors.textSecondary },

  // Call tracking
  sectionHeader2: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.md, marginBottom: 10 },
  sectionTitle2: { fontSize: 16, fontWeight: '800', color: colors.text },
  viewAll: { fontSize: 13, color: colors.primary, fontWeight: '700' },

  // Today's Reminder
  reminderEmptyText: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.md },
  callCard: { width: 110, backgroundColor: '#fff', borderRadius: 14, padding: 12, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 1 },
  callBadge: { position: 'absolute', top: -6, right: -6, backgroundColor: '#FF4444', width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  callBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  callIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#EEF6FF', justifyContent: 'center', alignItems: 'center', marginBottom: 6 },
  callLabel: { fontSize: 11, color: colors.textSecondary, textAlign: 'center', lineHeight: 15 },

  // Create lead
  createLeadBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: colors.primary,
    marginHorizontal: spacing.md, marginVertical: 14,
    paddingVertical: 18,
    borderRadius: borderRadius.xl,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  createLeadBtnText: { fontSize: 17, fontWeight: '800', color: '#fff' },

  // Explore
  exploreRow: { flexDirection: 'row', paddingHorizontal: spacing.md, gap: 10, marginBottom: 20 },
  exploreCard: { flex: 1, borderRadius: borderRadius.xl, padding: 16, alignItems: 'center', gap: 8, position: 'relative' },
  exploreIconWrap: { width: 60, height: 60, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  exploreLabel: { fontSize: 13, fontWeight: '800' },
  exploreSoon: { position: 'absolute', top: 6, right: 6, backgroundColor: '#FEE2E2', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  exploreSoonText: { fontSize: 8, fontWeight: '800', color: '#EF4444' },
});
