import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TextInput } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dropReasonService } from '../../src/services/dropReason.service';
import { apiErrorMessage } from '../../src/services/api';
import { useAuth } from '../../src/stores/auth.store';
import { queryKeys } from '../../src/lib/queryKeys';
import {
  CenterDialog,
  ConfirmDialog,
  EmptyState,
  PrimaryButton,
  ScreenHeader,
} from '../../src/components/ui';
import type { LeadDropReason } from '../../src/types';
import { colors, spacing, borderRadius, shadows } from '../../src/theme';

const MAX_NAME = 80;

/**
 * Leads Drop Tags — the reasons offered when a lead is closed as lost.
 *
 * Organizers curate the list; everyone else sees it read-only. Removing a tag
 * only takes it out of the picker: a lead already dropped with it keeps the
 * reason, because the lead stores it as text.
 */
export default function DropReasonsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { isOrganizer } = useAuth();

  const [editing, setEditing] = useState<LeadDropReason | 'new' | null>(null);
  const [name, setName] = useState('');
  const [removing, setRemoving] = useState<LeadDropReason | null>(null);

  const reasons = useQuery({
    queryKey: queryKeys.lookups.dropReasons,
    queryFn: () => dropReasonService.list(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.lookups.dropReasons });

  const openEditor = (target: LeadDropReason | 'new') => {
    setName(target === 'new' ? '' : target.name);
    setEditing(target);
  };

  const closeEditor = () => {
    setEditing(null);
    setName('');
  };

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (editing === 'new') await dropReasonService.create(trimmed);
      else if (editing) await dropReasonService.rename(editing._id, trimmed);
    },
    onSuccess: () => {
      closeEditor();
      void invalidate();
    },
    onError: (error) => Alert.alert(t('common.error'), apiErrorMessage(error, t('dropReasons.saveFailed'))),
  });

  const remove = useMutation({
    mutationFn: (reason: LeadDropReason) => dropReasonService.remove(reason._id),
    onSuccess: () => {
      setRemoving(null);
      void invalidate();
    },
    onError: (error) => {
      setRemoving(null);
      Alert.alert(t('common.error'), apiErrorMessage(error, t('dropReasons.saveFailed')));
    },
  });

  const renderItem = ({ item }: { item: LeadDropReason }) => (
    <View style={styles.row}>
      <View style={styles.tagIcon}>
        <Ionicons name="pricetag-outline" size={18} color={colors.text} />
      </View>
      <Text style={styles.name} numberOfLines={2}>
        {item.name}
      </Text>
      {isOrganizer ? (
        <>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => openEditor(item)}
            accessibilityRole="button"
            accessibilityLabel={t('dropReasons.renameLabel', { name: item.name })}
          >
            <Ionicons name="pencil" size={16} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, styles.iconBtnDanger]}
            onPress={() => setRemoving(item)}
            accessibilityRole="button"
            accessibilityLabel={t('dropReasons.removeLabel', { name: item.name })}
          >
            <Ionicons name="trash" size={16} color="#FFFFFF" />
          </TouchableOpacity>
        </>
      ) : null}
    </View>
  );

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={t('dropReasons.title')}
        actions={
          isOrganizer
            ? [{ icon: 'add', onPress: () => openEditor('new'), accessibilityLabel: t('dropReasons.add') }]
            : []
        }
      />

      {reasons.isLoading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : reasons.isError ? (
        <EmptyState
          icon="cloud-offline-outline"
          title={t('dropReasons.loadFailed')}
          actionLabel={t('common.tryAgain')}
          onAction={() => void reasons.refetch()}
        />
      ) : (
        <FlatList
          data={reasons.data ?? []}
          keyExtractor={(item) => item._id}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]}
          refreshControl={
            <RefreshControl
              refreshing={reasons.isRefetching}
              onRefresh={() => void reasons.refetch()}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListHeaderComponent={<Text style={styles.intro}>{t('dropReasons.intro')}</Text>}
          ListEmptyComponent={
            <EmptyState
              icon="pricetags-outline"
              title={t('dropReasons.emptyTitle')}
              message={isOrganizer ? t('dropReasons.emptyMessage') : undefined}
              actionLabel={isOrganizer ? t('dropReasons.add') : undefined}
              onAction={isOrganizer ? () => openEditor('new') : undefined}
            />
          }
        />
      )}

      <CenterDialog
        visible={editing !== null}
        onDismiss={closeEditor}
        title={editing === 'new' ? t('dropReasons.addTitle') : t('dropReasons.renameTitle')}
        titleVariant="plain"
      >
        <TextInput
          mode="outlined"
          label={t('dropReasons.nameLabel')}
          value={name}
          onChangeText={setName}
          maxLength={MAX_NAME}
          autoFocus
          autoCapitalize="sentences"
          outlineColor={colors.inputBorder}
          activeOutlineColor={colors.inputBorderFocused}
          style={styles.input}
        />
        <PrimaryButton
          label={t('common.save')}
          onPress={() => save.mutate()}
          disabled={!name.trim()}
          loading={save.isPending}
          style={styles.dialogButton}
        />
      </CenterDialog>

      <ConfirmDialog
        visible={!!removing}
        title={removing ? t('dropReasons.removeTitle', { name: removing.name }) : ''}
        message={t('dropReasons.removeMessage')}
        confirmLabel={t('dropReasons.remove')}
        cancelLabel={t('common.cancel')}
        loading={remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  loader: { marginVertical: spacing.xl },
  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  intro: { fontSize: 13, color: colors.textSecondary, lineHeight: 19, marginBottom: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    ...shadows.sm,
  },
  tagIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceVariant,
  },
  name: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  iconBtnDanger: { backgroundColor: colors.error },
  input: { backgroundColor: colors.surface },
  dialogButton: { marginTop: spacing.sm },
});
