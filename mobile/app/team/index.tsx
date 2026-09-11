import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Menu, TextInput } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { userService, TeamMember } from '../../src/services/user.service';
import { apiErrorMessage } from '../../src/services/api';
import { useAuth } from '../../src/stores/auth.store';
import { queryKeys } from '../../src/lib/queryKeys';
import { canManageRole } from '../../src/config/roles';
import { useDebouncedValue } from '../../src/hooks/useDebouncedValue';
import {
  Avatar,
  CenterDialog,
  ConfirmDialog,
  EmptyState,
  FilterTabs,
  PrimaryButton,
  ScreenHeader,
  SearchBar,
} from '../../src/components/ui';
import { formatDate, toTitleCase } from '../../src/utils/format';
import { colors, spacing, borderRadius, shadows } from '../../src/theme';

type StatusTab = 'active' | 'inactive';

const PAGE_SIZE = 50;
const MIN_PASSWORD = 6;

/**
 * Team Members — the organizer's User Management.
 *
 * Anyone who reaches the organizer home sees the list. Actions appear only with
 * `users.manage`, and only on members at or below the caller's own role. Both
 * are courtesy: the API refuses the same things (MOB-2).
 *
 * Passwords are never shown. The reference app lists each member's password in
 * plain text; LeadBee stores only a hash, so the one thing an admin can do is
 * set a new one.
 */
export default function TeamScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user, hasPermission, reloadSession } = useAuth();

  const [status, setStatus] = useState<StatusTab>('active');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [toggling, setToggling] = useState<TeamMember | null>(null);
  const [resetting, setResetting] = useState<TeamMember | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const canManageTeam = hasPermission('users.manage');

  const members = useInfiniteQuery({
    queryKey: [...queryKeys.users.all, 'manage', status, debouncedSearch],
    queryFn: ({ pageParam }) =>
      userService.listPage({
        isActive: status === 'active',
        search: debouncedSearch || undefined,
        page: pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });

  // Tab counts ignore the search box, so they read as team size, not matches.
  const activeCount = useQuery({
    queryKey: [...queryKeys.users.all, 'count', 'active'],
    queryFn: async () => (await userService.listPage({ isActive: true, page: 1, limit: 1 })).total,
  });
  const inactiveCount = useQuery({
    queryKey: [...queryKeys.users.all, 'count', 'inactive'],
    queryFn: async () => (await userService.listPage({ isActive: false, page: 1, limit: 1 })).total,
  });

  const refreshTeam = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.users.all });
    // Seats used live on the organization, which the profile's plan banner reads.
    void reloadSession().catch(() => undefined);
  };

  const toggleMutation = useMutation({
    mutationFn: (member: TeamMember) => userService.setActive(member._id, !member.isActive),
    onSuccess: () => {
      setToggling(null);
      refreshTeam();
    },
    onError: (error) => {
      setToggling(null);
      Alert.alert(t('common.error'), apiErrorMessage(error, t('team.actionFailed')));
    },
  });

  const closeReset = () => {
    setResetting(null);
    setNewPassword('');
    setConfirmPassword('');
  };

  const resetMutation = useMutation({
    mutationFn: ({ member, password }: { member: TeamMember; password: string }) =>
      userService.resetPassword(member._id, password),
    onSuccess: (_result, { member }) => {
      closeReset();
      Alert.alert(t('common.success'), t('team.passwordReset', { name: member.name }));
    },
    onError: (error) => Alert.alert(t('common.error'), apiErrorMessage(error, t('team.actionFailed'))),
  });

  const submitReset = () => {
    if (!resetting) return;
    if (newPassword.length < MIN_PASSWORD) {
      Alert.alert(t('common.error'), t('team.passwordTooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert(t('common.error'), t('team.passwordMismatch'));
      return;
    }
    resetMutation.mutate({ member: resetting, password: newPassword });
  };

  const roleLabel = (member: TeamMember): string => {
    // A custom role's own name says more than the built-in role it sits on.
    const custom =
      typeof member.roleId === 'object' && member.roleId.name !== member.role
        ? member.roleId.name
        : undefined;
    return custom ?? t(`team.roles.${member.role}`, { defaultValue: toTitleCase(member.role) });
  };

  const renderMember = ({ item }: { item: TeamMember }) => {
    const isSelf = item._id === user?._id;
    const canManage = canManageTeam && !!user && canManageRole(user.role, item.role);
    const joined = formatDate(item.createdAt, { day: 'numeric', month: 'short', year: 'numeric' });

    return (
      <View style={[styles.card, !item.isActive && styles.cardInactive]}>
        <Avatar name={item.name} size={48} variant={item.isActive ? 'solid' : 'tint'} />

        <View style={styles.cardBody}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            {isSelf ? (
              <View style={styles.youChip}>
                <Text style={styles.youText}>{t('team.you')}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.role} numberOfLines={1}>
            {[roleLabel(item), item.designation].filter(Boolean).join(' · ')}
          </Text>
          <MetaLine icon="call-outline" text={item.phone} />
          {item.email ? <MetaLine icon="mail-outline" text={item.email} /> : null}
          {joined ? <Text style={styles.joined}>{t('team.joined', { date: joined })}</Text> : null}
        </View>

        {canManage ? (
          <Menu
            visible={menuFor === item._id}
            onDismiss={() => setMenuFor(null)}
            contentStyle={styles.menu}
            anchor={
              <TouchableOpacity
                style={styles.menuBtn}
                onPress={() => setMenuFor(item._id)}
                accessibilityRole="button"
                accessibilityLabel={t('team.actionsFor', { name: item.name })}
              >
                <Ionicons name="ellipsis-vertical" size={18} color={colors.text} />
              </TouchableOpacity>
            }
          >
            <Menu.Item
              title={t('team.edit')}
              leadingIcon="pencil-outline"
              titleStyle={styles.menuText}
              onPress={() => {
                setMenuFor(null);
                router.push(`/team/form?id=${item._id}`);
              }}
            />
            {!isSelf && item.isActive ? (
              <Menu.Item
                title={t('team.resetPassword')}
                leadingIcon="lock-reset"
                titleStyle={styles.menuText}
                onPress={() => {
                  setMenuFor(null);
                  setResetting(item);
                }}
              />
            ) : null}
            {!isSelf ? (
              <Menu.Item
                title={item.isActive ? t('team.deactivate') : t('team.activate')}
                leadingIcon={item.isActive ? 'account-off-outline' : 'account-check-outline'}
                titleStyle={styles.menuText}
                onPress={() => {
                  setMenuFor(null);
                  setToggling(item);
                }}
              />
            ) : null}
          </Menu>
        ) : null}
      </View>
    );
  };

  const rows = members.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={t('team.title')}
        actions={
          canManageTeam
            ? [
                {
                  icon: 'person-add-outline',
                  onPress: () => router.push('/team/form'),
                  accessibilityLabel: t('team.addMember'),
                },
              ]
            : []
        }
      />

      <View style={styles.controls}>
        <SearchBar value={search} onChangeText={setSearch} placeholder={t('team.searchPlaceholder')} />
      </View>

      <FilterTabs
        tabs={[
          { value: 'active', label: t('team.tabActive'), count: activeCount.data },
          { value: 'inactive', label: t('team.tabInactive'), count: inactiveCount.data },
        ]}
        value={status}
        onChange={setStatus}
      />

      {members.isLoading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : members.isError ? (
        <EmptyState
          icon="cloud-offline-outline"
          title={t('team.loadFailed')}
          actionLabel={t('common.tryAgain')}
          onAction={() => void members.refetch()}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(member) => member._id}
          renderItem={renderMember}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]}
          onEndReached={() => {
            if (members.hasNextPage && !members.isFetchingNextPage) void members.fetchNextPage();
          }}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={members.isRefetching && !members.isFetchingNextPage}
              onRefresh={() => {
                void members.refetch();
                void activeCount.refetch();
                void inactiveCount.refetch();
              }}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListFooterComponent={
            members.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title={status === 'active' ? t('team.emptyActive') : t('team.emptyInactive')}
              message={debouncedSearch ? undefined : t('team.emptyMessage')}
            />
          }
        />
      )}

      <ConfirmDialog
        visible={!!toggling}
        tone={toggling?.isActive ? 'danger' : 'primary'}
        icon={toggling?.isActive ? 'person-remove' : 'person-add'}
        title={
          toggling
            ? t(toggling.isActive ? 'team.deactivateTitle' : 'team.activateTitle', { name: toggling.name })
            : ''
        }
        message={toggling?.isActive ? t('team.deactivateMessage') : t('team.activateMessage')}
        confirmLabel={toggling?.isActive ? t('team.deactivate') : t('team.activate')}
        cancelLabel={t('common.cancel')}
        loading={toggleMutation.isPending}
        onCancel={() => setToggling(null)}
        onConfirm={() => toggling && toggleMutation.mutate(toggling)}
      />

      <CenterDialog
        visible={!!resetting}
        onDismiss={closeReset}
        title={t('team.resetTitle')}
        titleVariant="plain"
      >
        <Text style={styles.dialogMessage}>
          {resetting ? t('team.resetMessage', { name: resetting.name }) : ''}
        </Text>
        <TextInput
          mode="outlined"
          label={t('team.newPassword')}
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          outlineColor={colors.inputBorder}
          activeOutlineColor={colors.inputBorderFocused}
          style={styles.input}
        />
        <TextInput
          mode="outlined"
          label={t('team.confirmPassword')}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          outlineColor={colors.inputBorder}
          activeOutlineColor={colors.inputBorderFocused}
          style={styles.input}
        />
        <PrimaryButton
          label={t('team.resetPassword')}
          onPress={submitReset}
          loading={resetMutation.isPending}
          style={styles.dialogButton}
        />
      </CenterDialog>
    </View>
  );
}

function MetaLine({
  icon,
  text,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
}) {
  return (
    <View style={styles.metaLine}>
      <Ionicons name={icon} size={13} color={colors.textSecondary} />
      <Text style={styles.metaText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  controls: { padding: spacing.md, paddingBottom: spacing.sm, backgroundColor: colors.surface },
  loader: { marginVertical: spacing.xl },
  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    ...shadows.sm,
  },
  cardInactive: { opacity: 0.7 },
  cardBody: { flex: 1, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { flexShrink: 1, fontSize: 16, fontWeight: '700', color: colors.text },
  youChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceVariant,
  },
  youText: { fontSize: 11, fontWeight: '700', color: colors.text },
  role: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 2 },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { flexShrink: 1, fontSize: 13, color: colors.text },
  joined: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
  menuBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  menu: { backgroundColor: colors.surface, borderRadius: borderRadius.lg },
  menuText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  dialogMessage: { fontSize: 13.5, color: colors.textSecondary, lineHeight: 20, textAlign: 'center' },
  input: { backgroundColor: colors.surface },
  dialogButton: { marginTop: spacing.sm },
});
