import React, { useEffect, useRef } from 'react';
import { Text, StyleSheet, Animated, Pressable, GestureResponderEvent } from 'react-native';
import { Tabs, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, borderRadius } from '../../src/theme';

interface TabButtonProps {
  icon: string;
  activeIcon: string;
  label: string;
  tint?: string;
  focused: boolean;
  onPress?: (e: GestureResponderEvent) => void;
  accessibilityLabel?: string;
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
  accessibilityLabel,
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
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={accessibilityLabel ?? label}
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
            <LeadTabButton
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
