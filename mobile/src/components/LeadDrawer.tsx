import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Pressable,
  Image,
  Dimensions,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme';
import { useAuth } from '../stores/auth.store';
import { useOrganizationSwitcher } from './organizations/OrganizationSwitcher';
import { Avatar } from './ui';
import { toTitleCase } from '../utils/format';

const DRAWER_WIDTH = Dimensions.get('window').width * 0.78;

/**
 * Read from the manifest rather than typed in: a hard-coded version goes stale
 * the first time nobody remembers to change it, and it is the number a user
 * reads out when reporting a bug. Settings does the same.
 */
const APP_VERSION = Constants.expoConfig?.version;

interface Props {
  visible: boolean;
  onClose: () => void;
}

type IconName = keyof typeof Ionicons.glyphMap;

/** One row of the menu, in the order it is drawn. */
type MenuEntry =
  | { kind: 'group'; label: string; icon: IconName; items: { label: string; onPress: () => void }[] }
  | { kind: 'link'; label: string; icon: IconName; onPress: () => void; tone?: 'danger' }
  | { kind: 'soon'; label: string; icon: IconName }
  | { kind: 'divider'; key: string };

/**
 * The Lead module's slide-in menu, reachable from the hamburger on every
 * screen in the `(leads)` group. Lives here rather than inside one screen so
 * Home, Reminder and Calendar can all open the same menu.
 */
export function LeadDrawer({ visible, onClose }: Props) {
  const router = useRouter();
  const { t } = useTranslation();
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const { user, organization, logout } = useAuth();
  const { openSwitcher } = useOrganizationSwitcher();

  /**
   * The one section currently unfolded, or `null` for none — which is how the
   * drawer opens. A menu that starts fully expanded is a list with decorative
   * chevrons: it pushes the items below it off-screen and makes the reader scan
   * leaves before they have picked a branch. One at a time also means the whole
   * menu always fits, however many sections it grows.
   */
  const [openSection, setOpenSection] = useState<string | null>(null);
  const toggleSection = (name: string) =>
    setOpenSection((prev) => (prev === name ? null : name));

  useEffect(() => {
    Animated.timing(translateX, {
      toValue: visible ? 0 : -DRAWER_WIDTH,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [visible, translateX]);

  // Every open starts from the same place. Picking an item navigates and closes
  // the drawer, so an unfolded section is the state of one visit, not a setting.
  useEffect(() => {
    if (visible) setOpenSection(null);
  }, [visible]);

  const nav = (path: string) => {
    onClose();
    router.push(path as any);
  };

  const confirmLogout = () => {
    Alert.alert(t('profile.logoutConfirmTitle'), t('profile.logoutConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.logout'),
        style: 'destructive',
        onPress: async () => {
          onClose();
          await logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  /*
   * Ordered by how often a salesperson reaches for each, as the reference app
   * orders them: the daily work (leads, tasks, meetings) first, then the tools
   * used during that work, then what is opened now and then, and the account
   * rows last. Rows with a sub-menu sit in that same order rather than being
   * grouped apart from the plain links.
   */
  const menu: MenuEntry[] = [
    // Daily work
    {
      kind: 'group',
      label: 'Leads',
      icon: 'people-outline',
      items: [
        { label: 'Create New Lead', onPress: () => nav('/lead/add') },
        { label: 'All Leads', onPress: () => nav('/lead/list') },
      ],
    },
    {
      kind: 'group',
      label: 'Task',
      icon: 'clipboard-outline',
      items: [
        { label: 'Create New Task', onPress: () => nav('/task/create') },
        { label: 'My Tasks', onPress: () => nav('/task/list') },
      ],
    },
    { kind: 'link', label: 'Meeting', icon: 'people-circle-outline', onPress: () => nav('/meeting/list') },
    { kind: 'link', label: 'BookMarks', icon: 'bookmark-outline', onPress: () => nav('/bookmarks') },
    // Tools used during that work
    {
      kind: 'group',
      label: t('drawer.callReport'),
      icon: 'call-outline',
      items: [
        { label: t('calls.title'), onPress: () => nav('/call') },
        { label: t('calls.analytics.title'), onPress: () => nav('/call/analytics') },
      ],
    },
    { kind: 'link', label: t('drawer.quickReplies'), icon: 'chatbubble-outline', onPress: () => nav('/quick-replies') },
    { kind: 'link', label: t('drawer.documents'), icon: 'document-outline', onPress: () => nav('/documents') },
    // Now and then — the bell on Home is the usual way in to notifications.
    { kind: 'link', label: t('drawer.notifications'), icon: 'notifications-outline', onPress: () => nav('/notifications') },
    { kind: 'soon', label: 'Announcement', icon: 'megaphone-outline' },
    { kind: 'soon', label: 'Attendance', icon: 'calendar-outline' },
    // Account
    { kind: 'divider', key: 'account' },
    { kind: 'link', label: t('profile.title'), icon: 'person-circle-outline', onPress: () => nav('/(leads)/profile') },
    { kind: 'link', label: t('settings.title'), icon: 'settings-outline', onPress: () => nav('/account/settings') },
    { kind: 'link', label: t('common.logout'), icon: 'log-out-outline', tone: 'danger', onPress: confirmLogout },
  ];

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={styles.backdrop} onPress={onClose} />

      <Animated.View style={[styles.panel, { transform: [{ translateX }] }]}>
        <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
          <View style={styles.logoWrap}>
            <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
            {APP_VERSION ? <Text style={styles.version}>v{APP_VERSION}</Text> : null}
          </View>

          {/* The organization this menu belongs to — tap to switch or add one. */}
          {organization ? (
            <TouchableOpacity
              style={styles.orgCard}
              onPress={() => {
                onClose();
                openSwitcher();
              }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={t('organizations.openSwitcher', { name: organization.name })}
            >
              <Avatar name={organization.name} size={38} variant="solid" />
              <View style={styles.orgText}>
                <Text style={styles.orgName} numberOfLines={1}>
                  {organization.name}
                </Text>
                {user ? (
                  <Text style={styles.orgRole} numberOfLines={1}>
                    {toTitleCase(user.role)}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}

          <View style={styles.divider} />

          {menu.map((entry) => {
            if (entry.kind === 'divider') {
              return <View key={entry.key} style={styles.divider} />;
            }

            if (entry.kind === 'soon') {
              return (
                <View key={entry.label} style={styles.sectionHeader}>
                  <View style={styles.sectionIcon}>
                    <Ionicons name={entry.icon} size={20} color={colors.textSecondary} />
                  </View>
                  <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{entry.label}</Text>
                  <View style={styles.soonBadge}>
                    <Text style={styles.soonText}>SOON</Text>
                  </View>
                </View>
              );
            }

            if (entry.kind === 'link') {
              const danger = entry.tone === 'danger';
              return (
                <TouchableOpacity
                  key={entry.label}
                  style={styles.sectionHeader}
                  onPress={entry.onPress}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                >
                  <View style={[styles.sectionIcon, danger && styles.dangerIcon]}>
                    <Ionicons name={entry.icon} size={20} color={danger ? colors.error : colors.primary} />
                  </View>
                  <Text style={[styles.sectionLabel, danger && { color: colors.error }]}>{entry.label}</Text>
                </TouchableOpacity>
              );
            }

            const isOpen = openSection === entry.label;
            return (
              <View key={entry.label}>
                {/* The header carries a chevron, so it has to actually fold —
                    it drew one either way before, and tapping it did nothing. */}
                <TouchableOpacity
                  style={[styles.sectionHeader, isOpen && styles.sectionHeaderOpen]}
                  onPress={() => toggleSection(entry.label)}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                >
                  <View style={styles.sectionIcon}>
                    <Ionicons name={entry.icon} size={20} color={colors.primary} />
                  </View>
                  <Text style={styles.sectionLabel}>{entry.label}</Text>
                  {/* ">" marks a row that holds a sub-menu; it turns down once unfolded.
                      Rows that go straight to a screen carry no chevron. */}
                  <Ionicons
                    name={isOpen ? 'chevron-down' : 'chevron-forward'}
                    size={16}
                    color={isOpen ? colors.primary : colors.textSecondary}
                  />
                </TouchableOpacity>
                {isOpen &&
                  entry.items.map((item) => (
                    <TouchableOpacity
                      key={item.label}
                      style={styles.subItem}
                      onPress={item.onPress}
                      activeOpacity={0.75}
                    >
                      <Ionicons name="chevron-forward-outline" size={14} color={colors.primary} style={{ marginLeft: 4 }} />
                      <Text style={styles.subLabel}>{item.label}</Text>
                    </TouchableOpacity>
                  ))}
              </View>
            );
          })}
        </ScrollView>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Developed by Spirit Solutions</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  panel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 16,
  },
  logoWrap: { paddingHorizontal: 20, paddingTop: 52, paddingBottom: 16, alignItems: 'center' },
  logo: { width: 130, height: 50 },
  version: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  orgCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceVariant,
  },
  orgText: { flex: 1, minWidth: 0 },
  orgName: { fontSize: 15, fontWeight: '700', color: colors.text },
  orgRole: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  divider: { height: 1, backgroundColor: '#F0F0F0', marginVertical: 4 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: `${colors.primary}15`,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionHeaderOpen: { backgroundColor: '#F8F9FF' },
  dangerIcon: { backgroundColor: `${colors.error}15` },
  sectionLabel: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
  subItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    gap: 10,
    backgroundColor: '#F8F9FF',
  },
  subLabel: { fontSize: 14, fontWeight: '600', color: colors.primary },
  soonBadge: { backgroundColor: '#FEE2E2', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  soonText: { fontSize: 9, fontWeight: '800', color: '#EF4444' },
  footer: { borderTopWidth: 1, borderTopColor: '#F0F0F0', paddingVertical: 16, alignItems: 'center' },
  footerText: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
});
