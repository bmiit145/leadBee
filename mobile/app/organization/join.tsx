import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import { colors, spacing, borderRadius } from '../../src/theme';
import { Avatar, StatusChip } from '../../src/components/ui';
import { queryKeys } from '../../src/lib/queryKeys';
import {
  inviteErrorKey,
  joinService,
  tokenFromInviteLink,
} from '../../src/services/invite.service';
import { useAuth } from '../../src/stores/auth.store';
import { useDebouncedValue } from '../../src/hooks/useDebouncedValue';
import { formatDate } from '../../src/utils/format';
import { tapFeedback, warningFeedback } from '../../src/utils/haptics';
import type { JoinRequest, OrganizationInvite } from '../../src/types';

/** Typed codes are 8 characters; a pasted link is longer and is reduced server-side. */
const CODE_LENGTH = 8;

const isCode = (value: string) => value.replace(/[^a-z0-9]/gi, '').length === CODE_LENGTH;
/** An invitation token is long and not a code — that is how the two are told apart. */
const isToken = (value: string) => tokenFromInviteLink(value).length > 20;

/**
 * How someone with no organization gets into one: paste the invite link or
 * code a colleague sent, see whose organization it is, and join — or ask to.
 *
 * Also lists invitations addressed to them and requests they are waiting on,
 * the way GitHub shows pending invitations on the dashboard.
 */
export default function JoinOrganizationScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { joinOrganization, acceptInvitation, account } = useAuth();

  const [input, setInput] = useState('');
  const typed = useDebouncedValue(input.trim(), 400);
  const asCode = isCode(typed);

  const preview = useQuery({
    queryKey: queryKeys.invites.preview(typed),
    queryFn: () => joinService.preview(typed),
    enabled: asCode,
    retry: false,
    staleTime: 30_000,
  });

  const invitations = useQuery({
    queryKey: queryKeys.invites.myInvitations,
    queryFn: joinService.myInvitations,
  });
  const requests = useQuery({
    queryKey: queryKeys.invites.myRequests,
    queryFn: joinService.myRequests,
  });

  const fail = (error: unknown) => {
    warningFeedback();
    Alert.alert(t('common.error'), t(inviteErrorKey(error)));
  };

  const joinMutation = useMutation({
    mutationFn: async () =>
      isToken(typed) && !asCode
        ? (await acceptInvitation(tokenFromInviteLink(typed)), { status: 'joined' as const })
        : joinOrganization(typed),
    onSuccess: (result) => {
      tapFeedback();
      if (result.status === 'joined') {
        router.replace('/(leads)');
        return;
      }
      setInput('');
      qc.invalidateQueries({ queryKey: queryKeys.invites.myRequests });
      Alert.alert(
        t('join.requestedTitle'),
        t('join.requestedMessage', { organization: result.organizationName })
      );
    },
    onError: fail,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => joinService.cancelRequest(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.invites.myRequests }),
    onError: fail,
  });

  const paste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setInput(text.trim());
  };

  const previewError = preview.isError;
  const canSubmit = (asCode && preview.data && !preview.data.alreadyMember) || (!asCode && isToken(typed));

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityRole="button">
          <Ionicons name="chevron-back" size={20} color={colors.text} />
          <Text style={styles.backText}>{t('join.back')}</Text>
        </TouchableOpacity>

        <View style={styles.badge}>
          <Ionicons name="people-outline" size={30} color={colors.text} />
        </View>
        <Text style={styles.title}>{t('join.title')}</Text>
        <Text style={styles.subtitle}>{t('join.subtitle')}</Text>

        <View style={styles.inputRow}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={t('join.placeholder')}
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
          />
          <TouchableOpacity style={styles.pasteBtn} onPress={paste} accessibilityRole="button">
            <Ionicons name="clipboard-outline" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>{t('join.hint')}</Text>

        {/* What the code leads to, before anything is committed. */}
        {asCode && preview.isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : asCode && previewError ? (
          <View style={[styles.previewCard, styles.previewBad]}>
            <Ionicons name="alert-circle-outline" size={20} color={colors.error} />
            <Text style={styles.previewBadText}>{t('invites.errors.invalid')}</Text>
          </View>
        ) : asCode && preview.data ? (
          <View style={styles.previewCard}>
            <Avatar name={preview.data.organizationName} size={46} variant="solid" />
            <View style={styles.previewText}>
              <Text style={styles.previewName} numberOfLines={1}>
                {preview.data.organizationName}
              </Text>
              <Text style={styles.previewMeta}>
                {t('join.memberCount', { count: preview.data.memberCount })}
              </Text>
              <View style={styles.previewChips}>
                <StatusChip
                  label={t(`invites.roles.${preview.data.role}`)}
                  color={colors.primary}
                />
                {preview.data.requiresApproval ? (
                  <StatusChip label={t('join.needsApproval')} color="#F59E0B" />
                ) : null}
              </View>
            </View>
          </View>
        ) : null}

        {asCode && preview.data?.alreadyMember ? (
          <Text style={styles.alreadyMember}>{t('invites.errors.alreadyMember')}</Text>
        ) : null}

        <TouchableOpacity
          style={[styles.submit, !canSubmit && styles.submitOff]}
          onPress={() => joinMutation.mutate()}
          disabled={!canSubmit || joinMutation.isPending}
          accessibilityRole="button"
        >
          {joinMutation.isPending ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.submitText}>
              {asCode && preview.data?.requiresApproval ? t('join.request') : t('join.join')}
            </Text>
          )}
        </TouchableOpacity>

        {/* Invitations sent to this person, and what they are waiting on. */}
        {(invitations.data ?? []).length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>{t('join.invitationsTitle')}</Text>
            {(invitations.data ?? []).map((invite) => (
              <InvitationRow key={invite._id} invite={invite} email={account?.email} />
            ))}
          </>
        ) : null}

        {(requests.data ?? []).filter((request) => request.status === 'pending').length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>{t('join.requestsTitle')}</Text>
            {(requests.data ?? [])
              .filter((request) => request.status === 'pending')
              .map((request) => (
                <RequestRow
                  key={request._id}
                  request={request}
                  busy={cancelMutation.isPending}
                  onCancel={() => cancelMutation.mutate(request._id)}
                />
              ))}
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** An invitation waiting on this person; the link itself is in their email. */
function InvitationRow({ invite, email }: { invite: OrganizationInvite; email?: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.listCard}>
      <Avatar name={invite.organizationName ?? '?'} size={38} variant="solid" />
      <View style={styles.previewText}>
        <Text style={styles.listName} numberOfLines={1}>{invite.organizationName}</Text>
        <Text style={styles.previewMeta}>{t('join.invitedTo', { email: email ?? invite.email })}</Text>
        <Text style={styles.previewMeta}>
          {t('invites.expiresOn', {
            date: formatDate(invite.expiresAt, { day: 'numeric', month: 'short' }),
          })}
        </Text>
      </View>
    </View>
  );
}

function RequestRow({
  request,
  busy,
  onCancel,
}: {
  request: JoinRequest;
  busy: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.listCard}>
      <Avatar name={request.organizationName ?? '?'} size={38} variant="solid" />
      <View style={styles.previewText}>
        <Text style={styles.listName} numberOfLines={1}>{request.organizationName}</Text>
        <Text style={styles.previewMeta}>{t('join.waiting')}</Text>
      </View>
      <TouchableOpacity
        style={styles.cancelBtn}
        onPress={onCancel}
        disabled={busy}
        accessibilityRole="button"
      >
        <Text style={styles.cancelText}>{t('join.withdraw')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: spacing.lg },
  backText: { fontSize: 15, color: colors.text, fontWeight: '600' },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  subtitle: {
    fontSize: 13.5,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 6,
    marginBottom: spacing.lg,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    letterSpacing: 1,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  pasteBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  hint: { fontSize: 12.5, color: colors.textSecondary, marginTop: 8, lineHeight: 18 },
  loading: { marginVertical: spacing.lg },
  previewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  previewBad: { borderColor: `${colors.error}55`, backgroundColor: `${colors.error}0D` },
  previewBadText: { flex: 1, fontSize: 13.5, color: colors.error },
  previewText: { flex: 1, minWidth: 0 },
  previewName: { fontSize: 16, fontWeight: '800', color: colors.text },
  previewMeta: { fontSize: 12.5, color: colors.textSecondary, marginTop: 2 },
  previewChips: { flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  alreadyMember: { fontSize: 13, color: colors.textSecondary, marginTop: spacing.sm },
  submit: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  submitOff: { opacity: 0.4 },
  submitText: { color: '#FFFFFF', fontSize: 15.5, fontWeight: '700' },
  sectionTitle: {
    fontSize: 12.5,
    fontWeight: '800',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  listCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: spacing.md,
    marginBottom: 10,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  listName: { fontSize: 15, fontWeight: '700', color: colors.text },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: borderRadius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  cancelText: { fontSize: 13, fontWeight: '700', color: colors.text },
});
