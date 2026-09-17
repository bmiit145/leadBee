import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, spacing, borderRadius } from '../../src/theme';
import { callTracking } from '../../src/services/callTracking';
import { ScreenHeader } from '../../src/components/ui';

/**
 * The disclosure Google Play requires before the call-log permission is asked
 * for, and what anyone deserves before an app reads their call log: what is
 * read, what is sent, what never leaves the phone, who can see it, and how to
 * stop it.
 *
 * Nothing here asks Android for anything. The permission prompt comes only
 * after the person chooses to continue.
 */
export default function CallConsentScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [working, setWorking] = useState(false);

  const points = [
    {
      icon: 'call-outline' as const,
      title: t('calls.consent.read.title'),
      body: t('calls.consent.read.body'),
    },
    {
      icon: 'shield-checkmark-outline' as const,
      title: t('calls.consent.private.title'),
      body: t('calls.consent.private.body'),
    },
    {
      icon: 'people-outline' as const,
      title: t('calls.consent.shared.title'),
      body: t('calls.consent.shared.body'),
    },
    {
      icon: 'close-circle-outline' as const,
      title: t('calls.consent.stop.title'),
      body: t('calls.consent.stop.body'),
    },
  ];

  const onAllow = async () => {
    setWorking(true);
    try {
      // Consent first, then the system prompt — never the other way round.
      await callTracking.grantConsent();
      const granted = await callTracking.requestPermission();
      if (!granted) {
        await callTracking.withdrawConsent();
        Alert.alert(t('calls.consent.deniedTitle'), t('calls.consent.deniedBody'));
        return;
      }
      void callTracking.sync();
      router.replace('/call');
    } finally {
      setWorking(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t('calls.consent.title')} />

      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + 24, gap: spacing.md }}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="call" size={26} color={colors.primary} />
          </View>
          <Text style={styles.heroTitle}>{t('calls.consent.heading')}</Text>
          <Text style={styles.heroBody}>{t('calls.consent.summary')}</Text>
        </View>

        <View style={styles.card}>
          {points.map((point, index) => (
            <View key={point.title} style={[styles.point, index > 0 && styles.pointDivided]}>
              <View style={styles.pointIcon}>
                <Ionicons name={point.icon} size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.pointTitle}>{point.title}</Text>
                <Text style={styles.pointBody}>{point.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={styles.policyRow}
          onPress={() =>
            Linking.openURL('https://leadbee.app/privacy/call-data').catch(() =>
              Alert.alert(t('calls.consent.policyUnavailable'))
            )
          }
          accessibilityRole="link"
        >
          <Ionicons name="document-text-outline" size={16} color={colors.primary} />
          <Text style={styles.policyText}>{t('calls.consent.policy')}</Text>
          <Ionicons name="open-outline" size={14} color={colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.allow, working && styles.disabled]}
          onPress={onAllow}
          disabled={working}
          accessibilityRole="button"
        >
          <Text style={styles.allowText}>{t('calls.consent.allow')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.decline} onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.declineText}>{t('calls.consent.decline')}</Text>
        </TouchableOpacity>

        <Text style={styles.footnote}>{t('calls.consent.footnote')}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  hero: { alignItems: 'center', gap: 10, paddingVertical: spacing.md },
  heroIcon: {
    width: 62,
    height: 62,
    borderRadius: 20,
    backgroundColor: `${colors.primary}0D`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { fontSize: 19, fontWeight: '800', color: colors.text, textAlign: 'center' },
  heroBody: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  point: { flexDirection: 'row', gap: 12, paddingVertical: 12 },
  pointDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  pointIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointTitle: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  pointBody: { fontSize: 13, color: colors.textSecondary, lineHeight: 19, marginTop: 2 },
  policyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  policyText: { flex: 1, fontSize: 13.5, fontWeight: '600', color: colors.primary },
  allow: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingVertical: 15,
    alignItems: 'center',
  },
  allowText: { fontSize: 15.5, fontWeight: '700', color: '#FFFFFF' },
  disabled: { opacity: 0.6 },
  decline: { paddingVertical: 12, alignItems: 'center' },
  declineText: { fontSize: 14.5, fontWeight: '700', color: colors.textSecondary },
  footnote: { fontSize: 12, color: colors.textSecondary, textAlign: 'center', lineHeight: 17 },
});
