import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Image, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Button } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/stores/auth.store';
import { NoOrganizationIllustration } from '../src/components/illustrations/NoOrganizationIllustration';
import { colors, spacing, borderRadius } from '../src/theme';

/**
 * Where someone lands when they are signed in but belong to no organization —
 * typically right after registering.
 *
 * A destination, not an error: their credentials are fine and the next thing
 * to do is get into an organization. Creating one and joining one are the two
 * ways in. Create works; join is still to be built (KNOWN-GAPS 6.2), so its
 * button is in place and does nothing yet.
 */
export default function NoOrganizationScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { account, logout, reloadAccount } = useAuth();

  const [addedToOrganization, setAddedToOrganization] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // An admin may add this person to an organization while the app is open.
  // Checked on arrival and whenever the app returns to the foreground.
  const checkMemberships = useCallback(async () => {
    try {
      setAddedToOrganization((await reloadAccount()) > 0);
    } catch {
      // A refused session is handled by the API client; a network blip changes
      // nothing on this screen.
    }
  }, [reloadAccount]);

  useEffect(() => {
    void checkMemberships();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkMemberships();
    });
    return () => subscription.remove();
  }, [checkMemberships]);

  const signOut = async () => {
    try {
      setSigningOut(true);
      await logout();
      router.replace('/(auth)/login');
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />

      <View style={styles.topBar}>
        <View style={styles.brand}>
          <Image
            source={require('../assets/leadbee-icon.png')}
            style={styles.brandIcon}
            resizeMode="contain"
            accessibilityLabel="LeadBee logo"
          />
          <Text style={styles.brandName}>LeadBee</Text>
        </View>
        <Button
          mode="text"
          compact
          icon="logout"
          onPress={signOut}
          loading={signingOut}
          disabled={signingOut}
          textColor={colors.textSecondary}
        >
          {t('noOrganization.signOut')}
        </Button>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <NoOrganizationIllustration accessibilityLabel={t('noOrganization.illustration')} />

        <View style={styles.copy}>
          {account?.firstName ? (
            <Text style={styles.greeting}>
              {t('noOrganization.greeting', { name: account.firstName })}
            </Text>
          ) : null}
          <Text style={styles.title}>{t('noOrganization.title')}</Text>
          <Text style={styles.body}>{t('noOrganization.body')}</Text>
        </View>

        {addedToOrganization && (
          <View style={styles.notice}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <View style={styles.noticeText}>
              <Text style={styles.noticeTitle}>{t('noOrganization.addedTitle')}</Text>
              <Text style={styles.noticeBody}>{t('noOrganization.addedBody')}</Text>
            </View>
            <Button mode="text" compact onPress={signOut} textColor={colors.text}>
              {t('noOrganization.signInAgain')}
            </Button>
          </View>
        )}

        <View style={styles.actions}>
          <Button
            mode="contained"
            icon="plus"
            onPress={() => router.push('/organization/create')}
            style={styles.button}
            contentStyle={styles.buttonContent}
            labelStyle={styles.buttonLabel}
            buttonColor={colors.primary}
          >
            {t('noOrganization.create')}
          </Button>
          <Text style={styles.actionHint}>{t('noOrganization.createHint')}</Text>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>{t('noOrganization.or')}</Text>
            <View style={styles.dividerLine} />
          </View>

          <Button
            mode="outlined"
            icon="account-group-outline"
            // Wired when "join an organization" is built (KNOWN-GAPS 6.2).
            onPress={() => undefined}
            style={[styles.button, styles.outlinedButton]}
            contentStyle={styles.buttonContent}
            labelStyle={styles.buttonLabel}
            textColor={colors.text}
          >
            {t('noOrganization.join')}
          </Button>
          <Text style={styles.actionHint}>{t('noOrganization.joinHint')}</Text>
        </View>

        {account?.email ? (
          <View style={styles.signedInAs}>
            <Ionicons name="person-circle-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.signedInAsText} numberOfLines={1}>
              {t('noOrganization.signedInAs', { email: account.email })}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
  },
  brand: { flexDirection: 'row', alignItems: 'center' },
  brandIcon: { width: 28, height: 28, borderRadius: borderRadius.sm },
  brandName: {
    marginLeft: spacing.sm,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: colors.text,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  copy: { alignItems: 'center', marginTop: spacing.md },
  greeting: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  title: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: colors.text,
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 340,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingLeft: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.lg,
  },
  noticeText: { flex: 1 },
  noticeTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  noticeBody: { fontSize: 13, color: colors.textSecondary, marginTop: 1 },
  actions: { marginTop: spacing.xl },
  button: { borderRadius: borderRadius.md },
  outlinedButton: { borderColor: colors.border, borderWidth: 1.5 },
  buttonContent: { height: 54 },
  buttonLabel: { fontSize: 15, fontWeight: '700', letterSpacing: 0.1 },
  actionHint: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: {
    marginHorizontal: spacing.sm,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  signedInAs: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.xl,
  },
  signedInAsText: { fontSize: 12, color: colors.textSecondary, flexShrink: 1 },
});
