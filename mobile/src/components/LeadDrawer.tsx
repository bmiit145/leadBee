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
} from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme';

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

/**
 * The Lead module's slide-in menu, reachable from the hamburger on every
 * screen in the `(leads)` group. Lives here rather than inside one screen so
 * Home, Reminder and Calendar can all open the same menu.
 */
export function LeadDrawer({ visible, onClose }: Props) {
  const router = useRouter();
  const { t } = useTranslation();
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;

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

  const sections = [
    {
      section: 'Leads',
      icon: 'people-outline' as const,
      items: [
        { label: 'Create New Lead', onPress: () => nav('/lead/add') },
        { label: 'All Leads', onPress: () => nav('/lead/list') },
      ],
    },
    {
      section: 'Task',
      icon: 'clipboard-outline' as const,
      items: [
        { label: 'Create New Task', onPress: () => nav('/task/create') },
        { label: 'My Tasks', onPress: () => nav('/task/list') },
      ],
    },
  ];

  const directItems = [
    { label: 'Meeting', icon: 'people-circle-outline' as const, onPress: () => nav('/meeting/list') },
    { label: 'BookMarks', icon: 'bookmark-outline' as const, onPress: () => nav('/bookmarks') },
    { label: t('drawer.notifications'), icon: 'notifications-outline' as const, onPress: () => nav('/notifications') },
    { label: t('drawer.quickReplies'), icon: 'chatbubble-outline' as const, onPress: () => nav('/quick-replies') },
    { label: t('drawer.documents'), icon: 'document-outline' as const, onPress: () => nav('/documents') },
  ];

  const comingSoon = [
    { label: 'Call Tracking', icon: 'call-outline' as const },
    { label: 'Announcement', icon: 'megaphone-outline' as const },
    { label: 'Attendance', icon: 'calendar-outline' as const },
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

          <View style={styles.divider} />

          {sections.map((section) => {
            const isOpen = openSection === section.section;
            return (
              <View key={section.section}>
                {/* The header carries a chevron, so it has to actually fold —
                    it drew one either way before, and tapping it did nothing. */}
                <TouchableOpacity
                  style={styles.sectionHeader}
                  onPress={() => toggleSection(section.section)}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                >
                  <View style={styles.sectionIcon}>
                    <Ionicons name={section.icon} size={20} color={colors.primary} />
                  </View>
                  <Text style={styles.sectionLabel}>{section.section}</Text>
                  <Ionicons
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
                {isOpen &&
                  section.items.map((item) => (
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
                <View style={styles.divider} />
              </View>
            );
          })}

          {directItems.map((item) => (
            <TouchableOpacity
              key={item.label}
              style={styles.sectionHeader}
              onPress={item.onPress}
              activeOpacity={0.75}
            >
              <View style={styles.sectionIcon}>
                <Ionicons name={item.icon} size={20} color={colors.primary} />
              </View>
              <Text style={styles.sectionLabel}>{item.label}</Text>
              <Ionicons name="chevron-forward-outline" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          ))}
          <View style={styles.divider} />

          {comingSoon.map((item) => (
            <View key={item.label} style={styles.sectionHeader}>
              <View style={styles.sectionIcon}>
                <Ionicons name={item.icon} size={20} color={colors.textSecondary} />
              </View>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{item.label}</Text>
              <View style={styles.soonBadge}>
                <Text style={styles.soonText}>SOON</Text>
              </View>
            </View>
          ))}
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
