import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useUnreadNotifications } from '../hooks/useUnreadNotifications';
import { localeTag } from '../utils/format';
import { colors } from '../theme';

const BADGE_CEILING = 99;

interface Props {
  style?: StyleProp<ViewStyle>;
  color?: string;
}

/** The top-bar bell: opens the inbox and carries the unread badge. */
export function NotificationBell({ style, color = '#FFFFFF' }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const unread = useUnreadNotifications();

  const badge =
    unread > BADGE_CEILING
      ? `${BADGE_CEILING.toLocaleString(localeTag())}+`
      : unread.toLocaleString(localeTag());

  return (
    <TouchableOpacity
      style={style}
      onPress={() => router.push('/notifications')}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={
        unread > 0 ? t('notifications.bellLabelUnread', { count: unread }) : t('notifications.bellLabel')
      }
    >
      <Ionicons name={unread > 0 ? 'notifications' : 'notifications-outline'} size={21} color={color} />
      {unread > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText} numberOfLines={1}>
            {badge}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: 4,
    right: 2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.error,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF' },
});
