import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, borderRadius } from '../../theme';

interface Props {
  phone: string;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  bookmarkPending?: boolean;
}

/** Strips spaces/dashes and adds the India country code when it's a bare 10-digit number. */
function toDialable(raw: string): string {
  const digits = (raw || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  return digits.length === 10 ? `+91${digits}` : digits;
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
export function LeadQuickActions({ phone, isBookmarked, onToggleBookmark, bookmarkPending }: Props) {
  const dial = toDialable(phone);

  return (
    <View style={styles.bar}>
      <TouchableOpacity
        style={[styles.cell, styles.bookmarkCell]}
        onPress={onToggleBookmark}
        disabled={bookmarkPending}
        accessibilityLabel={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
      >
        <Ionicons name={isBookmarked ? 'bookmark' : 'bookmark-outline'} size={17} color="#D64545" />
      </TouchableOpacity>

      <View style={styles.divider} />

      <TouchableOpacity
        style={[styles.cell, styles.whatsappCell]}
        onPress={() => open(`whatsapp://send?phone=${dial}`, 'WhatsApp is not installed.')}
        accessibilityLabel="Message on WhatsApp"
      >
        <Ionicons name="logo-whatsapp" size={17} color="#1E8E5A" />
      </TouchableOpacity>

      <View style={styles.divider} />

      <TouchableOpacity
        style={[styles.cell, styles.callCell]}
        onPress={() => open(`tel:${dial}`, 'Cannot place a call from this device.')}
        accessibilityLabel="Call"
      >
        <Ionicons name="call" size={16} color={colors.primary} />
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
  bookmarkCell: { backgroundColor: '#D6454514' },
  whatsappCell: { backgroundColor: '#1E8E5A14' },
  callCell: { backgroundColor: `${colors.primary}14` },
  divider: { width: 1, backgroundColor: colors.surface },
});
