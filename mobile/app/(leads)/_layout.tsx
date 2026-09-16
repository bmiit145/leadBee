import React, { useEffect, useRef } from 'react';
import { Text, StyleSheet, Animated, Pressable, GestureResponderEvent } from 'react-native';
import { Tabs, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  useOrganizationSwitcher,
  useQuickOrganizationSwitch,
} from '../../src/components/organizations/OrganizationSwitcher';
import { selectionFeedback } from '../../src/utils/haptics';
import { colors, borderRadius } from '../../src/theme';

/** Two taps closer together than this are a double tap, not two visits to Profile. */
const DOUBLE_TAP_MS = 320;

interface TabButtonProps {
  icon: string;
  activeIcon: string;
  label: string;
  tint?: string;
  focused: boolean;
  // React Navigation hands these down as null when a tab has no handler.
  onPress?: ((e: GestureResponderEvent) => void) | null;
  onLongPress?: ((e: GestureResponderEvent) => void) | null;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

/**
 * One item in the Lead module's bottom bar.
 *
 * Rendered via `tabBarButton` rather than `tabBarIcon` because the active
 * state is a wide icon+label pill: React Navigation sizes the icon slot for an
 * icon and clips anything wider, which silently swallowed the label.
 */
function LeadTabButton({
  icon,
  activeIcon,
  label,
  tint = colors.primary,
  focused,
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint,
}: TabButtonProps) {
  // 0 = inactive (icon only), 1 = active (pill + label).
  const anim = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: focused ? 1 : 0,
      useNativeDriver: false, // width/background can't run on the native driver
      friction: 9,
      tension: 90,
    }).start();
  }, [focused, anim]);

  return (
    <Pressable
      style={styles.item}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
    >
      <Animated.View
        style={[
          styles.pill,
          {
            backgroundColor: anim.interpolate({
              inputRange: [0, 1],
              outputRange: ['rgba(0,0,0,0)', `${tint}1F`],
            }),
            paddingHorizontal: anim.interpolate({ inputRange: [0, 1], outputRange: [10, 12] }),
          },
        ]}
      >
        <Ionicons
          name={(focused ? activeIcon : icon) as any}
          size={focused ? 20 : 23}
          color={focused ? tint : colors.textSecondary}
        />
        <Animated.Text
          numberOfLines={1}
          style={[
            styles.label,
            {
              color: tint,
              opacity: anim,
              maxWidth: anim.interpolate({ inputRange: [0, 1], outputRange: [0, 72] }),
              marginLeft: anim.interpolate({ inputRange: [0, 1], outputRange: [0, 5] }),
            },
          ]}
        >
          {label}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

/**
 * The Profile tab, which also carries the organization gestures.
 *
 * Double tap moves to the next organization and press-and-hold opens the
 * switcher — the pair Instagram uses for accounts, so people arrive already
 * knowing them. With nowhere to switch to, a double tap opens the switcher
 * instead of doing nothing, which is where an organization is created or
 * joined.
 */
function ProfileTabButton({ focused, onPress, ...rest }: TabButtonProps) {
  const { t } = useTranslation();
  const { openSwitcher } = useOrganizationSwitcher();
  const switchToNext = useQuickOrganizationSwitch();
  const lastPressAt = useRef(0);

  const handleLongPress = () => {
    selectionFeedback();
    openSwitcher();
  };

  const handlePress = (event: GestureResponderEvent) => {
    const now = Date.now();
    const isDoubleTap = now - lastPressAt.current < DOUBLE_TAP_MS;
    // Reset after a double tap, so three taps are not two switches.
    lastPressAt.current = isDoubleTap ? 0 : now;

    // The first tap still opens Profile; the second one switches from there.
    onPress?.(event);
    if (!isDoubleTap) return;

    void switchToNext().then((result) => {
      if (result === 'no-other') openSwitcher();
    });
  };

  return (
    <LeadTabButton
      {...rest}
      focused={focused}
      onPress={handlePress}
      onLongPress={handleLongPress}
      accessibilityHint={t('organizations.tabGestureHint')}
    />
  );
}

/**
 * LeadBee's bottom bar.
 *
 * In the app this was ported from, the lead workspace was a mini-app nested
 * inside a larger property product, with a trailing "Exit" tab to leave it.
 * Here the lead workspace *is* the product, so there is nothing to exit to and
 * that tab is gone.
 */
export default function LeadsTabLayout() {
  const insets = useSafeAreaInsets();
  // Derived from the route rather than the button's accessibilityState, which
  // Expo Router's Tabs does not populate — leaving every tab looking inactive.
  // `useSegments` is typed as a fixed tuple, so widen it to read the child.
  const segments: string[] = useSegments();
  const active = segments[1] ?? 'index';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        // Cross-fade between tabs instead of snapping.
        animation: 'fade',
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.borderLight,
          height: 64 + insets.bottom,
          paddingBottom: Math.max(8, insets.bottom),
          paddingTop: 8,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarButton: (p) => (
            <LeadTabButton
              {...p}
              icon="home-outline"
              activeIcon="home"
              label="Home"
              focused={active === 'index'}
              accessibilityLabel="Lead home"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="reminder"
        options={{
          tabBarButton: (p) => (
            <LeadTabButton
              {...p}
              icon="notifications-outline"
              activeIcon="notifications"
              label="Reminder"
              focused={active === 'reminder'}
              accessibilityLabel="Reminders"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          tabBarButton: (p) => (
            <LeadTabButton
              {...p}
              icon="calendar-outline"
              activeIcon="calendar"
              label="Calendar"
              focused={active === 'calendar'}
              accessibilityLabel="Calendar"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarButton: (p) => (
            <ProfileTabButton
              {...p}
              icon="person-circle-outline"
              activeIcon="person-circle"
              label="Profile"
              focused={active === 'profile'}
              accessibilityLabel="Lead profile"
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  item: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: borderRadius.full,
  },
  label: { fontSize: 11.5, fontWeight: '700' },
});
