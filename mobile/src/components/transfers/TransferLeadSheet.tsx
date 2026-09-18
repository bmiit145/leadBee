import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { colors, spacing, borderRadius } from '../../theme';
import { BottomSheet, Avatar } from '../ui';
import { queryKeys } from '../../lib/queryKeys';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { leadTransferService, transferErrorKey } from '../../services/leadTransfer.service';
import { toTitleCase } from '../../utils/format';
import { tapFeedback, warningFeedback } from '../../utils/haptics';
import type { TransferRecipient } from '../../types';

/** The server's minimum — kept equal so the button enables exactly when it would accept. */
const MIN_REASON = 3;
const MAX_REASON = 500;

interface Props {
  visible: boolean;
  onDismiss: () => void;
  leadId: string;
  /** The lead's current owner, left out of the list: a lead cannot go to its owner. */
  ownerId?: string;
  /** An organizer's transfer applies at once; everyone else's waits for acceptance. */
  isOrganizer: boolean;
}

/**
 * Hand a lead to a colleague: who, and why.
 *
 * The reason is required because the recipient decides on it, and it is the
 * first thing anyone reading the lead's history later wants to know.
 */
export function TransferLeadSheet({ visible, onDismiss, leadId, ownerId, isOrganizer }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [recipient, setRecipient] = useState<TransferRecipient | null>(null);
  const [reason, setReason] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  // Each opening starts clean: a half-filled transfer from last time is not a draft.
  useEffect(() => {
    if (visible) {
      setSearch('');
      setRecipient(null);
      setReason('');
    }
  }, [visible]);

  const recipientsQuery = useQuery({
    queryKey: queryKeys.transfers.recipients(debouncedSearch),
    queryFn: () => leadTransferService.recipients(debouncedSearch),
    enabled: visible,
    staleTime: 60_000,
  });
  const recipients = (recipientsQuery.data ?? []).filter((member) => member._id !== ownerId);

  const transferMutation = useMutation({
    mutationFn: () =>
      leadTransferService.request({
        leadId,
        toUserId: recipient!._id,
        reason: reason.trim(),
      }),
    onSuccess: ({ completed }) => {
      tapFeedback();
      qc.invalidateQueries({ queryKey: queryKeys.leads.all });
      qc.invalidateQueries({ queryKey: queryKeys.leads.detail(leadId) });
      // The API writes the request to the lead's Time Line.
      qc.invalidateQueries({ queryKey: queryKeys.leads.thread(leadId, 'timeline') });
      onDismiss();
      Alert.alert(
        t('common.success'),
        t(completed ? 'transfers.doneToast' : 'transfers.sentToast', { name: recipient!.name })
      );
    },
    onError: (error) => {
      warningFeedback();
      Alert.alert(t('common.error'), t(transferErrorKey(error)));
    },
  });

  const canSubmit =
    !!recipient && reason.trim().length >= MIN_REASON && !transferMutation.isPending;

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} maxHeightRatio={0.9}>
      <Text style={styles.title}>{t('transfers.sheet.title')}</Text>
      <Text style={styles.intro}>
        {t(isOrganizer ? 'transfers.sheet.introOrganizer' : 'transfers.sheet.introOwner')}
      </Text>

      <Text style={styles.label}>{t('transfers.sheet.recipient')}</Text>
      <View style={styles.search}>
        <Ionicons name="search" size={16} color={colors.textSecondary} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t('transfers.sheet.searchPlaceholder')}
          placeholderTextColor={colors.textSecondary}
          style={styles.searchInput}
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
        {recipientsQuery.isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.listState} />
        ) : recipientsQuery.isError ? (
          <TouchableOpacity style={styles.listState} onPress={() => recipientsQuery.refetch()}>
            <Text style={styles.stateText}>{t('transfers.errors.failed')}</Text>
            <Text style={styles.retry}>{t('common.tryAgain')}</Text>
          </TouchableOpacity>
        ) : recipients.length === 0 ? (
          <Text style={[styles.stateText, styles.listState]}>{t('transfers.sheet.noRecipients')}</Text>
        ) : (
          recipients.map((member) => {
            const selected = member._id === recipient?._id;
            return (
              <TouchableOpacity
                key={member._id}
                style={[styles.member, selected && styles.memberSelected]}
                onPress={() => setRecipient(member)}
                activeOpacity={0.75}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <Avatar name={member.name} size={36} />
                <View style={styles.memberText}>
                  <Text style={styles.memberName} numberOfLines={1}>{member.name}</Text>
                  <Text style={styles.memberRole}>{toTitleCase(member.role)}</Text>
                </View>
                <Ionicons
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={selected ? colors.primary : colors.border}
                />
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <Text style={styles.label}>{t('transfers.reason')}</Text>
      <TextInput
        value={reason}
        onChangeText={setReason}
        placeholder={t('transfers.sheet.reasonPlaceholder')}
        placeholderTextColor={colors.textSecondary}
        style={styles.reason}
        multiline
        maxLength={MAX_REASON}
        textAlignVertical="top"
      />
      <Text style={styles.hint}>{t('transfers.sheet.reasonHint')}</Text>

      <TouchableOpacity
        style={[styles.submit, !canSubmit && styles.submitOff]}
        onPress={() => transferMutation.mutate()}
        disabled={!canSubmit}
        activeOpacity={0.85}
        accessibilityRole="button"
      >
        {transferMutation.isPending ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            <Ionicons name="swap-horizontal" size={18} color="#FFFFFF" />
            <Text style={styles.submitText}>
              {t(isOrganizer ? 'transfers.sheet.submitOrganizer' : 'transfers.sheet.submitOwner')}
            </Text>
          </>
        )}
      </TouchableOpacity>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 19, fontWeight: '800', color: colors.text },
  intro: { fontSize: 13, color: colors.textSecondary, lineHeight: 19, marginTop: 4 },
  label: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14.5, color: colors.text },
  list: { maxHeight: 230, marginTop: spacing.xs },
  listState: { paddingVertical: spacing.lg, alignItems: 'center' },
  stateText: { fontSize: 13.5, color: colors.textSecondary, textAlign: 'center' },
  retry: { fontSize: 13.5, color: colors.primary, fontWeight: '700', marginTop: 4 },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  memberSelected: { borderColor: colors.primary, backgroundColor: `${colors.primary}0D` },
  memberText: { flex: 1, minWidth: 0 },
  memberName: { fontSize: 15, fontWeight: '700', color: colors.text },
  memberRole: { fontSize: 12.5, color: colors.textSecondary, marginTop: 1 },
  reason: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 76,
    fontSize: 14.5,
    color: colors.text,
  },
  hint: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  submit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingVertical: 14,
    marginTop: spacing.lg,
  },
  submitOff: { opacity: 0.45 },
  submitText: { color: '#FFFFFF', fontSize: 15.5, fontWeight: '700' },
});
