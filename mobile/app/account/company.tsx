import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/stores/auth.store';
import { Avatar, ScreenHeader, ListCard, ListRow, ListSectionTitle } from '../../src/components/ui';
import { formatDate, localeTag, toTitleCase } from '../../src/utils/format';
import { OrgStatus } from '../../src/types';
import { colors, spacing, borderRadius, shadows } from '../../src/theme';

const STATUS_KEYS: Record<OrgStatus, string> = {
  trialing: 'company.statusTrialing',
  active: 'company.statusActive',
  past_due: 'company.statusPastDue',
  suspended: 'company.statusSuspended',
  cancelled: 'company.statusCancelled',
};

/**
 * Read-only view of the member and their organization.
 *
 * Deliberately shows only what the tenant record actually holds. The screen
 * this layout is modelled on also lists a GST number; LeadBee organizations
 * have no such field, so it is absent rather than shown as "Not available".
 */
export default function MyCompanyScreen() {
  const { t } = useTranslation();
  const { user, organization } = useAuth();
  const insets = useSafeAreaInsets();

  if (!user) return null;

  const notSet = t('company.notSet');
  const roleName = user.roleId?.name ?? toTitleCase(user.role);
  const memberSince = formatDate(user.createdAt, { month: 'long', year: 'numeric' });

  const statusKey = organization ? STATUS_KEYS[organization.status] : undefined;
  const trialEnds =
    organization?.status === 'trialing'
      ? formatDate(organization.trialEndsAt, { day: 'numeric', month: 'short', year: 'numeric' })
      : undefined;
  // -1 means the plan does not cap team size. 0 is what the legacy mirror writes
  // when no seat limit is configured (entitlements/resolver.ts); "1 of 0" would
  // misstate that, so the headcount is shown on its own.
  const seats = organization
    ? organization.limits.maxUsers < 0
      ? t('company.unlimited')
      : organization.limits.maxUsers === 0
        ? organization.usage.users.toLocaleString(localeTag())
        : t('company.seatsValue', { used: organization.usage.users, max: organization.limits.maxUsers })
    : undefined;

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t('company.title')} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.identity}>
          <Avatar name={user.name} size={64} variant="solid" />
          <View style={styles.identityText}>
            <Text style={styles.name} numberOfLines={1}>
              {user.name}
            </Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>{roleName.toUpperCase()}</Text>
            </View>
          </View>
        </View>

        <ListSectionTitle>{t('company.memberInfo')}</ListSectionTitle>
        <ListCard>
          <ListRow icon="mail-outline" overline={t('profile.email')} title={user.email || notSet} />
          <ListRow icon="call-outline" overline={t('editProfile.mobileNumber')} title={user.phone} />
          <ListRow
            icon="briefcase-outline"
            overline={t('company.designation')}
            title={user.designation || notSet}
          />
          <ListRow
            icon="calendar-outline"
            overline={t('company.memberSince')}
            title={memberSince ?? notSet}
            isLast
          />
        </ListCard>

        {organization ? (
          <>
            <ListSectionTitle>{t('company.companyInfo')}</ListSectionTitle>
            <ListCard>
              <ListRow
                icon="business-outline"
                overline={t('company.companyName')}
                title={organization.name}
              />
              <ListRow
                icon="ribbon-outline"
                overline={t('company.plan')}
                title={toTitleCase(organization.plan)}
              />
              <ListRow
                icon="pulse-outline"
                overline={t('company.status')}
                title={statusKey ? t(statusKey) : toTitleCase(organization.status)}
              />
              {trialEnds ? (
                <ListRow icon="time-outline" overline={t('company.trialEnds')} title={trialEnds} />
              ) : null}
              <ListRow
                icon="people-outline"
                overline={t('company.teamMembers')}
                title={seats ?? notSet}
                isLast
              />
            </ListCard>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xxl,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.md,
  },
  identityText: { flex: 1, alignItems: 'flex-start' },
  name: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  roleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceVariant,
  },
  roleText: { fontSize: 11, fontWeight: '700', color: colors.text, letterSpacing: 0.8 },
});
