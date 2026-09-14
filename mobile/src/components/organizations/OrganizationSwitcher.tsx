import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../stores/auth.store';
import { organizationsService } from '../../services/organizations.service';
import { apiErrorMessage } from '../../services/api';
import { queryKeys } from '../../lib/queryKeys';
import { Avatar, BottomSheet } from '../ui';
import { InlineFeedback } from '../ui/InlineFeedback';
import { colors, spacing, borderRadius } from '../../theme';
import type { OrganizationSummary } from '../../types';
import { organizationMeta, organizationUnavailableReason } from './organizationLabels';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/** Short enough that a badge reflects a notification that just arrived. */
const OVERVIEW_STALE_MS = 15_000;

interface SwitcherContextValue {
  openSwitcher: () => void;
}

const SwitcherContext = createContext<SwitcherContextValue | null>(null);

/** Opens the one organization switcher, from anywhere under the root layout. */
export function useOrganizationSwitcher(): SwitcherContextValue {
  const context = useContext(SwitcherContext);
  if (!context) {
    throw new Error('useOrganizationSwitcher must be used within OrganizationSwitcherProvider');
  }
  return context;
}

/**
 * Owns the single organization switcher.
 *
 * Mounted once in the root layout. The drawer's organization card and the
 * profile's organization name both call `openSwitcher`, so there is one sheet
 * with one behaviour however it was reached.
 */
export function OrganizationSwitcherProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const openSwitcher = useCallback(() => setVisible(true), []);
  const value = useMemo(() => ({ openSwitcher }), [openSwitcher]);

  return (
    <SwitcherContext.Provider value={value}>
      {children}
      <OrganizationSwitcherSheet visible={visible} onDismiss={() => setVisible(false)} />
    </SwitcherContext.Provider>
  );
}

function OrganizationSwitcherSheet({
  visible,
  onDismiss,
}: {
  visible: boolean;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { isAuthenticated, switchOrganization } = useAuth();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const overview = useQuery({
    queryKey: queryKeys.organizations.overview,
    queryFn: () => organizationsService.overview(),
    enabled: visible && isAuthenticated,
    staleTime: OVERVIEW_STALE_MS,
  });

  const close = () => {
    // A switch in flight finishes on its own; the sheet cannot be dismissed
    // out from under it.
    if (pendingId) return;
    setError(null);
    onDismiss();
  };

  const navigate = (path: string) => {
    close();
    router.push(path as any);
  };

  const onPick = async (org: OrganizationSummary) => {
    if (org.isCurrent) {
      close();
      return;
    }
    try {
      setPendingId(org._id);
      setError(null);
      await switchOrganization(org._id, org.name);
      setPendingId(null);
      onDismiss();
      // Home of the organization just opened, whatever screen this came from.
      router.replace('/(leads)');
    } catch (err) {
      setPendingId(null);
      setError(apiErrorMessage(err, t('organizations.switchFailed')));
      // The list may be what changed — a suspension, a removed membership.
      void overview.refetch();
    }
  };

  const ownership = overview.data?.ownership;
  const createBlocked = ownership ? !ownership.canCreate : false;

  return (
    <BottomSheet visible={visible} onDismiss={close} maxHeightRatio={0.85}>
      <Text style={styles.title}>{t('organizations.switcherTitle')}</Text>

      {error ? (
        <View style={styles.feedback}>
          <InlineFeedback
            tone="error"
            title={t('organizations.switchFailed')}
            message={error}
            onDismiss={() => setError(null)}
          />
        </View>
      ) : null}

      {overview.isLoading ? (
        <ActivityIndicator color={colors.primary} style={styles.loading} />
      ) : overview.isError ? (
        <View style={styles.loadError}>
          <Text style={styles.loadErrorText}>{t('organizations.loadFailed')}</Text>
          <TouchableOpacity onPress={() => void overview.refetch()} accessibilityRole="button">
            <Text style={styles.retry}>{t('organizations.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {overview.data?.organizations.map((org) => (
            <OrganizationOption
              key={org._id}
              org={org}
              pending={pendingId === org._id}
              disabled={pendingId !== null}
              onPress={() => void onPick(org)}
            />
          ))}
        </ScrollView>
      )}

      <View style={styles.divider} />

      <ActionRow
        icon="add"
        label={t('organizations.create')}
        hint={
          createBlocked && ownership
            ? t('organizations.limitReached', { limit: ownership.limit })
            : undefined
        }
        disabled={createBlocked || pendingId !== null}
        onPress={() => navigate('/organization/create')}
      />
      <ActionRow
        icon="enter-outline"
        label={t('organizations.join')}
        disabled={pendingId !== null}
        // Wired when "join an organization" is built (KNOWN-GAPS 6.2).
        onPress={() => undefined}
      />
      <ActionRow
        icon="settings-outline"
        label={t('organizations.manage')}
        disabled={pendingId !== null}
        onPress={() => navigate('/account/organizations')}
        chevron
      />
    </BottomSheet>
  );
}

function OrganizationOption({
  org,
  pending,
  disabled,
  onPress,
}: {
  org: OrganizationSummary;
  pending: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const unavailable = organizationUnavailableReason(org, t);
  const inactive = disabled || unavailable !== null;

  return (
    <TouchableOpacity
      style={[
        styles.option,
        org.isCurrent && styles.optionCurrent,
        unavailable !== null && styles.optionUnavailable,
      ]}
      onPress={onPress}
      disabled={inactive}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityState={{ selected: org.isCurrent, disabled: inactive, busy: pending }}
      accessibilityLabel={`${org.name}, ${unavailable ?? organizationMeta(org, t)}`}
    >
      <Avatar name={org.name} size={42} variant={org.isCurrent ? 'solid' : 'tint'} />
      <View style={styles.optionText}>
        <View style={styles.nameRow}>
          <Text style={styles.optionName} numberOfLines={1}>
            {org.name}
          </Text>
          {org.isDefault ? (
            <Ionicons
              name="star"
              size={12}
              color={colors.warning}
              accessibilityLabel={t('organizations.default')}
            />
          ) : null}
        </View>
        <Text
          style={[styles.optionMeta, unavailable !== null && styles.optionMetaUnavailable]}
          numberOfLines={1}
        >
          {unavailable ?? organizationMeta(org, t)}
        </Text>
      </View>

      {pending ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : org.isCurrent ? (
        <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
      ) : org.unreadNotifications > 0 && unavailable === null ? (
        <View
          style={styles.unreadBadge}
          accessibilityLabel={t('organizations.unread', { count: org.unreadNotifications })}
        >
          <Text style={styles.unreadText}>
            {org.unreadNotifications > 99 ? '99+' : org.unreadNotifications}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function ActionRow({
  icon,
  label,
  hint,
  onPress,
  disabled = false,
  chevron = false,
}: {
  icon: IoniconName;
  label: string;
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
  chevron?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.action, disabled && styles.actionDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityHint={hint}
    >
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={18} color={colors.text} />
      </View>
      <View style={styles.optionText}>
        <Text style={styles.actionLabel}>{label}</Text>
        {hint ? <Text style={styles.actionHint}>{hint}</Text> : null}
      </View>
      {chevron ? <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} /> : null}
    </TouchableOpacity>
  );
}

/**
 * Covers the app while a switch is in flight, so nothing from the organization
 * being left can be tapped — or seen refetching — during the change.
 */
export function OrganizationTransitionOverlay({ organizationName }: { organizationName: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.overlay} accessibilityViewIsModal accessibilityLiveRegion="polite">
      <View style={styles.overlayCard}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.overlayText}>
          {t('organizations.switching', { name: organizationName })}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 19,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  feedback: { marginBottom: spacing.sm },
  loading: { paddingVertical: spacing.xl },
  loadError: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.sm },
  loadErrorText: { fontSize: 14, color: colors.textSecondary },
  retry: { fontSize: 14, fontWeight: '700', color: colors.text },
  list: { maxHeight: 320 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.lg,
    marginBottom: 4,
  },
  optionCurrent: { backgroundColor: colors.surfaceVariant },
  optionUnavailable: { opacity: 0.55 },
  optionText: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  optionName: { flexShrink: 1, fontSize: 15.5, fontWeight: '700', color: colors.text },
  optionMeta: { fontSize: 12.5, color: colors.textSecondary, marginTop: 2 },
  optionMetaUnavailable: { color: colors.error },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.lg,
  },
  actionDisabled: { opacity: 0.5 },
  actionIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  actionHint: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(255,255,255,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    elevation: 1000,
  },
  overlayCard: { alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl },
  overlayText: { fontSize: 15, fontWeight: '600', color: colors.text, textAlign: 'center' },
});
