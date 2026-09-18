import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, borderRadius } from '../../theme';
import { toDialable } from '../../utils/workFormat';

interface Props {
  phone: string;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  bookmarkPending?: boolean;
  /**
   * `compact` for list cards, where the bar is one of many on screen; the lead
   * page keeps the full-size bar as its main actions.
   */
  size?: 'regular' | 'compact';
}


async function open(url: string, unavailable: string) {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert(unavailable);
  }
}

/**
 * The single segmented action bar on every lead card: Bookmark | WhatsApp | Call.
 * One continuous pill with three cells, not three separate buttons — matches the
 * reference app exactly, so it's a dedicated component rather than ad-hoc styling
 * repeated at each call site.
 */
export function LeadQuickActions({
  phone,
  isBookmarked,
  onToggleBookmark,
  bookmarkPending,
  size = 'regular',
}: Props) {
  const dial = toDialable(phone);
  const compact = size === 'compact';
  const cell = [styles.cell, compact && styles.cellCompact];
  const iconSize = compact ? 15 : 17;

  return (
    <View style={styles.bar}>
      <TouchableOpacity
        style={[...cell, styles.bookmarkCell]}
        onPress={onToggleBookmark}
        disabled={bookmarkPending}
        accessibilityLabel={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
      >
        <Ionicons name={isBookmarked ? 'bookmark' : 'bookmark-outline'} size={iconSize} color="#D64545" />
      </TouchableOpacity>

      <View style={styles.divider} />

      <TouchableOpacity
        style={[...cell, styles.whatsappCell]}
        onPress={() => open(`whatsapp://send?phone=${dial}`, 'WhatsApp is not installed.')}
        accessibilityLabel="Message on WhatsApp"
      >
        <Ionicons name="logo-whatsapp" size={iconSize} color="#1E8E5A" />
      </TouchableOpacity>

      <View style={styles.divider} />

      <TouchableOpacity
        style={[...cell, styles.callCell]}
        onPress={() => open(`tel:${dial}`, 'Cannot place a call from this device.')}
        accessibilityLabel="Call"
      >
        <Ionicons name="call" size={iconSize - 1} color={colors.primary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
  },
  // Still comfortably over the 44 px minimum touch height once the card's
  // own padding is counted; the icon shrinks with it so the bar stays balanced.
  cellCompact: { paddingVertical: 7 },
  bookmarkCell: { backgroundColor: '#D6454514' },
  whatsappCell: { backgroundColor: '#1E8E5A14' },
  callCell: { backgroundColor: `${colors.primary}14` },
  divider: { width: 1, backgroundColor: colors.surface },
});
