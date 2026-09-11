import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { QuickReplyPanel } from '../src/components/QuickReplyPanel';
import { ScreenHeader } from '../src/components/ui';
import { colors } from '../src/theme';

/**
 * Quick Replies, reached from the drawer rather than a lead.
 *
 * The same list and editor as the lead's Quick Reply tab. With no lead there is
 * no number to send to, so a reply is shared through the system sheet instead
 * of opening WhatsApp on a chat.
 */
export default function QuickRepliesScreen() {
  const { t } = useTranslation();

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t('quickReplies.title')} />
      <QuickReplyPanel />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
});
