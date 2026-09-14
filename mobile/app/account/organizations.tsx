import React, { useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Button, IconButton, Menu } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../src/stores/auth.store';
import { organizationsService } from '../../src/services/organizations.service';
import { apiErrorMessage } from '../../src/services/api';
import { queryKeys } from '../../src/lib/queryKeys';
import { Avatar, ScreenHeader } from '../../src/components/ui';
import { InlineFeedback } from '../../src/components/ui/InlineFeedback';
import {
  organizationMeta,
  organizationUnavailableReason,
} from '../../src/components/organizations/organizationLabels';
import { colors, spacing, borderRadius, shadows } from '../../src/theme';
import type { OrganizationSummary } from '../../src/types';

/**
 * Every organization the person belongs to, and what they can do about each —
 * reached from the switcher's "Manage organizations" and from Profile.
 *
 * The switcher is for moving quickly; this is for managing: which one opens
 * first, what state each is in, how many more they may create. Leaving an
 * organization is not offered yet (KNOWN-GAPS 6.10).
 */
export default function OrganizationsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { switchOrganization, organizationTransition } = useAuth();

  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const overview = useQuery({
    queryKey: queryKeys.organizations.overview,
    queryFn: () => organizationsService.overview(),
    staleTime: 15_000,
  });

  const defaultMutation = useMutation({
    mutationFn: (organizationId: string | null) => organizationsService.setDefault(organizationId),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.organizations.overview, data),
    onError: (err) => setError(apiErrorMessage(err, t('organizations.defaultFailed'))),
  });

  const onSwitch = async (org: OrganizationSummary) => {
    try {
      setError(null);
      await switchOrganization(org._id, org.name);
      router.replace('/(leads)');
    } catch (err) {
      setError(apiErrorMessage(err, t('organizations.switchFailed')));
      void overview.refetch();
    }
  };

  const changeDefault = (organizationId: string | null) => {
    setMenuFor(null);
    setError(null);
    defaultMutation.mutate(organizationId);
  };

  const ownership = overview.data?.ownership;
  const busy = organizationTransition !== null || defaultMutation.isPending;

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('organizations.title')} />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(spacing.xl, insets.bottom + spacing.lg) },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={overview.isRefetching}
            onRefresh={() => void overview.refetch()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <Text style={styles.intro}>{t('organizations.subtitle')}</Text>

        {error ? (
          <View style={styles.feedback}>
            <InlineFeedback tone="error" message={error} onDismiss={() => setError(null)} />
          </View>
        ) : null}

        {overview.isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : overview.isError ? (
          <View style={styles.loadError}>
            <Text style={styles.loadErrorText}>{t('organizations.loadFailed')}</Text>
            <Button mode="text" onPress={() => void overview.refetch()} textColor={colors.text}>
              {t('organizations.retry')}
            </Button>
          </View>
        ) : (
          overview.data?.organizations.map((org) => {
            const unavailable = organizationUnavailableReason(org, t);
            return (
              <View key={org._id} style={[styles.card, org.isCurrent && styles.cardCurrent]}>
                <View style={styles.cardTop}>
                  <Avatar name={org.name} size={46} variant={org.isCurrent ? 'solid' : 'tint'} />
                  <View style={styles.cardText}>
                    <Text style={styles.orgName} numberOfLines={2}>
                      {org.name}
                    </Text>
                    <Text
                      style={[styles.meta, unavailable !== null && styles.metaUnavailable]}
                      numberOfLines={1}
                    >
                      {unavailable ?? organizationMeta(org, t)}
                    </Text>
                    <View style={styles.chips}>
                      {org.isCurrent ? (
                        <View style={[styles.chip, styles.chipCurrent]}>
                          <Text style={[styles.chipText, styles.chipTextCurrent]}>
                            {t('organizations.current')}
                          </Text>
                        </View>
                      ) : null}
                      {org.isDefault ? (
                        <View style={styles.chip}>
                          <Ionicons name="star" size={11} color={colors.warning} />
                          <Text style={styles.chipText}>{t('organizations.default')}</Text>
                        </View>
                      ) : null}
                      {org.unreadNotifications > 0 && unavailable === null ? (
                        <View style={styles.chip}>
                          <Text style={styles.chipText}>
                            {t('organizations.unread', { count: org.unreadNotifications })}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>

                  <Menu
                    visible={menuFor === org._id}
                    onDismiss={() => setMenuFor(null)}
                    anchor={
                      <IconButton
                        icon="dots-vertical"
                        size={20}
                        onPress={() => setMenuFor(org._id)}
                        disabled={busy || !org.membershipActive}
                        accessibilityLabel={t('organizations.actionsFor', { name: org.name })}
                      />
                    }
                  >
                    {org.isDefault ? (
                      <Menu.Item
                        leadingIcon="star-off-outline"
                        title={t('organizations.removeDefault')}
                        onPress={() => changeDefault(null)}
                      />
                    ) : (
                      <Menu.Item
                        leadingIcon="star-outline"
                        title={t('organizations.setDefault')}
                        onPress={() => changeDefault(org._id)}
                      />
                    )}
                  </Menu>
                </View>

                {!org.isCurrent && unavailable === null ? (
                  <Button
                    mode="outlined"
                    icon="swap-horizontal"
                    onPress={() => void onSwitch(org)}
                    disabled={busy}
                    loading={organizationTransition === org.name}
                    style={styles.switchButton}
                    textColor={colors.text}
                  >
                    {t('organizations.switch')}
                  </Button>
                ) : null}
              </View>
            );
          })
        )}

        <Text style={styles.defaultHint}>{t('organizations.defaultHint')}</Text>

        <View style={styles.actions}>
          {ownership ? (
            <Text style={[styles.ownership, !ownership.canCreate && styles.ownershipBlocked]}>
              {ownership.canCreate
                ? t('organizations.ownership', { owned: ownership.owned, limit: ownership.limit })
                : t('organizations.limitReached', { limit: ownership.limit })}
            </Text>
          ) : null}
          <Button
            mode="contained"
            icon="plus"
            onPress={() => router.push('/organization/create')}
            disabled={busy || (ownership ? !ownership.canCreate : false)}
            style={styles.button}
            contentStyle={styles.buttonContent}
            labelStyle={styles.buttonLabel}
            buttonColor={colors.primary}
          >
            {t('organizations.create')}
          </Button>
          <TouchableOpacity
            // Wired when "join an organization" is built (KNOWN-GAPS 6.2).
            onPress={() => undefined}
            disabled={busy}
            style={styles.joinButton}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Ionicons name="enter-outline" size={18} color={colors.text} />
            <Text style={styles.joinText}>{t('organizations.join')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.md },
  intro: { fontSize: 14, lineHeight: 20, color: colors.textSecondary, marginBottom: spacing.md },
  feedback: { marginBottom: spacing.md },
  loading: { paddingVertical: spacing.xl },
  loadError: { alignItems: 'center', paddingVertical: spacing.xl },
  loadErrorText: { fontSize: 14, color: colors.textSecondary },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xxl,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: 'transparent',
    ...shadows.md,
  },
  cardCurrent: { borderColor: colors.primary },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  cardText: { flex: 1, minWidth: 0 },
  orgName: { fontSize: 16.5, fontWeight: '700', color: colors.text },
  meta: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  metaUnavailable: { color: colors.error },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceVariant,
  },
  chipCurrent: { backgroundColor: colors.primary },
  chipText: { fontSize: 11.5, fontWeight: '600', color: colors.textSecondary },
  chipTextCurrent: { color: '#FFFFFF' },
  switchButton: { marginTop: spacing.md, borderRadius: borderRadius.md, borderColor: colors.border },
  defaultHint: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginVertical: spacing.sm,
  },
  actions: { marginTop: spacing.md },
  ownership: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  ownershipBlocked: { color: colors.error },
  button: { borderRadius: borderRadius.md },
  buttonContent: { height: 52 },
  buttonLabel: { fontSize: 15, fontWeight: '700' },
  joinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 52,
    marginTop: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  joinText: { fontSize: 15, fontWeight: '700', color: colors.text },
});
