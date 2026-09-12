import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  AlertButton,
  Linking,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leadService } from '../src/services/lead.service';
import { apiErrorMessage } from '../src/services/api';
import { queryKeys } from '../src/lib/queryKeys';
import { useDebouncedValue } from '../src/hooks/useDebouncedValue';
import {
  ConfirmDialog,
  EmptyState,
  FilterTabs,
  ScreenHeader,
  SearchBar,
} from '../src/components/ui';
import type { LeadDocumentKind, LibraryDocument } from '../src/types';
import { formatDate, localeTag } from '../src/utils/format';
import { colors, spacing, borderRadius, shadows } from '../src/theme';

type KindTab = 'all' | LeadDocumentKind;

const PAGE_SIZE = 30;
const KB = 1024;

/**
 * Document — every file linked to a lead you can reach, in one place.
 *
 * Files are still added from a lead's Document or Attachment tab: a file
 * without a lead has nothing to belong to, so there is no "add" here.
 */
export default function DocumentLibraryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [kind, setKind] = useState<KindTab>('all');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim());
  const [deleting, setDeleting] = useState<LibraryDocument | null>(null);

  const library = useInfiniteQuery({
    queryKey: queryKeys.documentLibrary.list(kind, debouncedSearch),
    queryFn: ({ pageParam }) =>
      leadService.getDocumentLibrary({
        kind: kind === 'all' ? undefined : kind,
        search: debouncedSearch || undefined,
        page: pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });

  const remove = useMutation({
    mutationFn: (doc: LibraryDocument) => leadService.deleteDocument(doc.lead!._id, doc._id),
    onSuccess: (_result, doc) => {
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: queryKeys.documentLibrary.all });
      if (doc.lead) void qc.invalidateQueries({ queryKey: queryKeys.leads.documents(doc.lead._id, doc.kind) });
    },
    onError: (error) => {
      setDeleting(null);
      Alert.alert(t('common.error'), apiErrorMessage(error, t('documents.deleteFailed')));
    },
  });

  const open = (doc: LibraryDocument) =>
    Linking.openURL(doc.url).catch(() => Alert.alert(t('common.error'), t('documents.cannotOpen')));

  const showActions = (doc: LibraryDocument) => {
    const buttons: AlertButton[] = [{ text: t('documents.open'), onPress: () => void open(doc) }];
    const lead = doc.lead;
    if (lead?.isActive) {
      buttons.push({ text: t('documents.viewLead'), onPress: () => router.push(`/lead/${lead._id}`) });
    }
    // Delete is addressed through the lead, and the API decides whether this
    // caller may (uploader or organizer). A deleted lead's files stay with it —
    // the delete is soft, so it can be undone — and are not offered for removal.
    if (lead?.isActive) {
      buttons.push({ text: t('documents.delete'), style: 'destructive', onPress: () => setDeleting(doc) });
    }
    buttons.push({ text: t('common.cancel'), style: 'cancel' });
    Alert.alert(doc.name, undefined, buttons);
  };

  const sizeLabel = (bytes?: number): string | undefined => {
    if (!bytes) return undefined;
    const kb = bytes / KB;
    return kb < KB
      ? t('documents.sizeKb', { size: Math.round(kb).toLocaleString(localeTag()) })
      : t('documents.sizeMb', {
          size: (kb / KB).toLocaleString(localeTag(), { maximumFractionDigits: 1 }),
        });
  };

  const renderItem = ({ item }: { item: LibraryDocument }) => {
    const leadLine = item.lead?.isActive
      ? `${item.lead.contactName} · ${item.lead.leadNumber}`
      : t('documents.leadDeleted');
    const meta = [
      item.uploadedByName,
      sizeLabel(item.size),
      formatDate(item.createdAt, { day: 'numeric', month: 'short', year: 'numeric' }),
    ]
      .filter(Boolean)
      .join(' · ');

    return (
      <View style={styles.row}>
        <View style={styles.fileIcon}>
          <Ionicons
            name={item.kind === 'document' ? 'document-text-outline' : 'attach-outline'}
            size={20}
            color={colors.text}
          />
        </View>
        <TouchableOpacity style={styles.body} onPress={() => void open(item)} activeOpacity={0.75}>
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.lead, !item.lead?.isActive && styles.leadMissing]} numberOfLines={1}>
            {leadLine}
          </Text>
          {meta ? (
            <Text style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.openBtn}
          onPress={() => void open(item)}
          accessibilityRole="button"
          accessibilityLabel={t('documents.open')}
        >
          <Ionicons name="arrow-redo" size={16} color="#FFFFFF" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.moreBtn}
          onPress={() => showActions(item)}
          accessibilityRole="button"
          accessibilityLabel={t('documents.actionsFor', { name: item.name })}
        >
          <Ionicons name="ellipsis-vertical" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
    );
  };

  const rows = library.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t('documents.title')} />

      <View style={styles.controls}>
        <SearchBar value={search} onChangeText={setSearch} placeholder={t('documents.searchPlaceholder')} />
      </View>

      <FilterTabs
        tabs={[
          { value: 'all', label: t('documents.tabAll') },
          { value: 'document', label: t('documents.tabDocuments') },
          { value: 'attachment', label: t('documents.tabAttachments') },
        ]}
        value={kind}
        onChange={setKind}
      />

      {library.isLoading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : library.isError ? (
        <EmptyState
          icon="cloud-offline-outline"
          title={t('documents.loadFailed')}
          actionLabel={t('common.tryAgain')}
          onAction={() => void library.refetch()}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item._id}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]}
          onEndReached={() => {
            if (library.hasNextPage && !library.isFetchingNextPage) void library.fetchNextPage();
          }}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={library.isRefetching && !library.isFetchingNextPage}
              onRefresh={() => void library.refetch()}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListFooterComponent={
            library.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="folder-open-outline"
              title={t('documents.emptyTitle')}
              message={debouncedSearch ? undefined : t('documents.emptyMessage')}
            />
          }
        />
      )}

      <ConfirmDialog
        visible={!!deleting}
        title={t('documents.deleteTitle')}
        message={deleting ? t('documents.deleteMessage', { name: deleting.name }) : ''}
        confirmLabel={t('documents.delete')}
        cancelLabel={t('common.cancel')}
        loading={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  controls: { padding: spacing.md, paddingBottom: spacing.sm, backgroundColor: colors.surface },
  loader: { marginVertical: spacing.xl },
  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    ...shadows.sm,
  },
  fileIcon: {
    width: 42,
    height: 42,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceVariant,
  },
  body: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  lead: { fontSize: 13, color: colors.text },
  leadMissing: { color: colors.textTertiary, fontStyle: 'italic' },
  meta: { fontSize: 12, color: colors.textSecondary },
  openBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  moreBtn: { width: 30, height: 34, alignItems: 'center', justifyContent: 'center' },
});
