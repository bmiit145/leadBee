import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Switch,
  TextInput,
  Alert,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { colors, spacing, borderRadius } from '../../src/theme';
import {
  ScreenHeader,
  Avatar,
  StatusChip,
  CenterDialog,
  ConfirmDialog,
  SegmentedTabs,
  EmptyState,
} from '../../src/components/ui';
import type { SegmentedTab } from '../../src/components/ui';
import { queryKeys } from '../../src/lib/queryKeys';
import {
  inviteService,
  inviteErrorKey,
  inviteUrlFor,
  joinUrlFor,
} from '../../src/services/invite.service';
import { useAuth } from '../../src/stores/auth.store';
import { formatDate } from '../../src/utils/format';
import { isValidEmail } from '../../src/utils/validators';
import { tapFeedback, warningFeedback } from '../../src/utils/haptics';
import type { InviteRole, JoinRequest, OrganizationInvite } from '../../src/types';

type Pane = 'requests' | 'invitations';

/**
 * Every way into the organization, on one screen: the shareable link with its
 * permissions, invitations by email, and the queue of people waiting to be let
 * in. Modelled on WhatsApp's "Group link" and GitHub's people settings.
 */
export default function InviteMembersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { organization } = useAuth();

  const [pane, setPane] = useState<Pane>('requests');
  const [email, setEmail] = useState('');
  const [qrOpen, setQrOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [sentInvite, setSentInvite] = useState<{ email: string; url: string } | null>(null);

  const linkQuery = useQuery({
    queryKey: queryKeys.invites.link,
    queryFn: inviteService.getLink,
  });
  const requestsQuery = useQuery({
    queryKey: queryKeys.invites.requests('pending'),
    queryFn: () => inviteService.listRequests('pending'),
  });
  const invitesQuery = useQuery({
    queryKey: queryKeys.invites.list('pending'),
    queryFn: () => inviteService.listInvites('pending'),
  });

  const link = linkQuery.data;
  const joinUrl = link ? joinUrlFor(link.code) : '';
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.invites.all });

  const fail = (error: unknown) => {
    warningFeedback();
    Alert.alert(t('common.error'), t(inviteErrorKey(error)));
  };

  const issueMutation = useMutation({
    mutationFn: () => inviteService.issueLink(),
    onSuccess: () => {
      tapFeedback();
      refresh();
    },
    onError: fail,
  });

  const settingsMutation = useMutation({
    mutationFn: (settings: { requiresApproval?: boolean; role?: InviteRole }) =>
      inviteService.updateLink(settings),
    onSuccess: () => refresh(),
    onError: fail,
  });

  const inviteMutation = useMutation({
    mutationFn: () => inviteService.invite({ email: email.trim().toLowerCase() }),
    onSuccess: ({ invite, token }) => {
      tapFeedback();
      setSentInvite({ email: invite.email, url: inviteUrlFor(token) });
      setEmail('');
      refresh();
    },
    onError: fail,
  });

  const decideMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) =>
      inviteService.decideRequest(id, decision),
    onSuccess: (_result, { decision }) => {
      tapFeedback();
      refresh();
      if (decision === 'approve') Alert.alert(t('common.success'), t('invites.approvedToast'));
    },
    onError: fail,
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => inviteService.revokeInvite(id),
    onSuccess: () => refresh(),
    onError: fail,
  });

  const share = async (message: string) => {
    try {
      await Share.share({ message });
    } catch {
      // Dismissing the share sheet is not a failure.
    }
  };

  const copy = async (value: string) => {
    await Clipboard.setStringAsync(value);
    tapFeedback();
    Alert.alert(t('invites.copied'));
  };

  const shareText = t('invites.shareMessage', {
    organization: organization?.name ?? '',
    url: joinUrl,
    code: link?.code ?? '',
  });

  const panes: SegmentedTab<Pane>[] = [
    { value: 'requests', label: t('invites.tabs.requests'), count: requestsQuery.data?.total ?? 0 },
    { value: 'invitations', label: t('invites.tabs.invitations'), count: invitesQuery.data?.total ?? 0 },
  ];

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t('invites.title')} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
        {/* Which organization this lets people into — the first thing to be sure of. */}
        <View style={styles.orgCard}>
          <Avatar name={organization?.name ?? '?'} size={46} variant="solid" />
          <View style={styles.orgText}>
            <Text style={styles.orgName} numberOfLines={1}>{organization?.name}</Text>
            <Text style={styles.orgHint}>{t('invites.orgHint')}</Text>
          </View>
        </View>

        {/* ─── The shareable link ─────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>{t('invites.linkTitle')}</Text>

        {linkQuery.isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : !link ? (
          <View style={styles.card}>
            <Text style={styles.emptyLink}>{t('invites.noLink')}</Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => issueMutation.mutate()}
              disabled={issueMutation.isPending}
              accessibilityRole="button"
            >
              {issueMutation.isPending ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryBtnText}>{t('invites.createLink')}</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.code} selectable>{link.code}</Text>
            <Text style={styles.url} numberOfLines={1} selectable>{joinUrl}</Text>

            <View style={styles.divider} />

            <LinkAction icon="copy-outline" label={t('invites.copyLink')} onPress={() => copy(joinUrl)} />
            <LinkAction icon="share-social-outline" label={t('invites.shareLink')} onPress={() => share(shareText)} />
            <LinkAction icon="qr-code-outline" label={t('invites.qrCode')} onPress={() => setQrOpen(true)} />
            <LinkAction
              icon="refresh-outline"
              label={t('invites.resetLink')}
              tone="danger"
              onPress={() => setResetOpen(true)}
            />
          </View>
        )}

        {/* ─── Permissions, as WhatsApp words them ────────────────────────── */}
        {link ? (
          <>
            <Text style={styles.sectionTitle}>{t('invites.permissionsTitle')}</Text>
            <View style={styles.card}>
              <View style={styles.settingRow}>
                <View style={styles.settingText}>
                  <Text style={styles.settingLabel}>{t('invites.approvalLabel')}</Text>
                  <Text style={styles.settingHint}>{t('invites.approvalHint')}</Text>
                </View>
                <Switch
                  value={link.requiresApproval}
                  onValueChange={(value) => settingsMutation.mutate({ requiresApproval: value })}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  thumbColor="#FFFFFF"
                />
              </View>

              <View style={styles.divider} />

              <Text style={styles.settingLabel}>{t('invites.roleLabel')}</Text>
              <Text style={styles.settingHint}>{t('invites.roleHint')}</Text>
              <View style={styles.roleRow}>
                {(['user', 'partner'] as InviteRole[]).map((role) => {
                  const active = link.role === role;
                  return (
                    <TouchableOpacity
                      key={role}
                      style={[styles.roleChip, active && styles.roleChipActive]}
                      onPress={() => settingsMutation.mutate({ role })}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.roleChipText, active && styles.roleChipTextActive]}>
                        {t(`invites.roles.${role}`)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </>
        ) : null}

        {/* ─── One person, by email ───────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>{t('invites.emailTitle')}</Text>
        <View style={styles.card}>
          <Text style={styles.settingHint}>{t('invites.emailHint')}</Text>
          <View style={styles.emailRow}>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder={t('invites.emailPlaceholder')}
              placeholderTextColor={colors.textSecondary}
              style={styles.emailInput}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              inputMode="email"
            />
            <TouchableOpacity
              style={[styles.sendBtn, !isValidEmail(email) && styles.sendBtnOff]}
              onPress={() => inviteMutation.mutate()}
              disabled={!isValidEmail(email) || inviteMutation.isPending}
              accessibilityRole="button"
              accessibilityLabel={t('invites.sendInvite')}
            >
              {inviteMutation.isPending ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Ionicons name="paper-plane" size={17} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* ─── Waiting on an admin ────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>{t('invites.pendingTitle')}</Text>
        <View style={styles.paneTabs}>
          <SegmentedTabs tabs={panes} value={pane} onChange={setPane} />
        </View>

        {pane === 'requests' ? (
          requestsQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} style={styles.loading} />
          ) : (requestsQuery.data?.data ?? []).length === 0 ? (
            <EmptyState
              icon="people-outline"
              title={t('invites.noRequests')}
              message={t('invites.noRequestsHint')}
            />
          ) : (
            (requestsQuery.data?.data ?? []).map((request) => (
              <RequestRow
                key={request._id}
                request={request}
                busy={decideMutation.isPending}
                onDecide={(decision) => decideMutation.mutate({ id: request._id, decision })}
              />
            ))
          )
        ) : invitesQuery.isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : (invitesQuery.data?.data ?? []).length === 0 ? (
          <EmptyState
            icon="mail-outline"
            title={t('invites.noInvites')}
            message={t('invites.noInvitesHint')}
          />
        ) : (
          (invitesQuery.data?.data ?? []).map((invite) => (
            <InviteRow
              key={invite._id}
              invite={invite}
              busy={revokeMutation.isPending}
              onRevoke={() => revokeMutation.mutate(invite._id)}
            />
          ))
        )}

        {/* The fourth way in: an admin creates the person outright. */}
        <TouchableOpacity
          style={styles.addDirectly}
          onPress={() => router.push('/team/form')}
          accessibilityRole="button"
        >
          <Ionicons name="person-add-outline" size={18} color={colors.primary} />
          <View style={styles.settingText}>
            <Text style={styles.addDirectlyLabel}>{t('invites.addDirectly')}</Text>
            <Text style={styles.settingHint}>{t('invites.addDirectlyHint')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </ScrollView>

      {/* ─── QR code, for handing the link over in person ──────────────────── */}
      <CenterDialog visible={qrOpen} onDismiss={() => setQrOpen(false)} title={t('invites.qrTitle')}>
        <View style={styles.qrWrap}>
          {joinUrl ? <QRCode value={joinUrl} size={196} backgroundColor="#FFFFFF" /> : null}
        </View>
        <Text style={styles.qrCode} selectable>{link?.code}</Text>
        <Text style={styles.qrHint}>{t('invites.qrHint')}</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => share(shareText)}>
          <Text style={styles.primaryBtnText}>{t('invites.shareLink')}</Text>
        </TouchableOpacity>
      </CenterDialog>

      <ConfirmDialog
        visible={resetOpen}
        onCancel={() => setResetOpen(false)}
        onConfirm={() => {
          setResetOpen(false);
          issueMutation.mutate();
        }}
        title={t('invites.resetTitle')}
        message={t('invites.resetMessage')}
        confirmLabel={t('invites.resetConfirm')}
        cancelLabel={t('common.cancel')}
        icon="refresh"
        loading={issueMutation.isPending}
      />

      {/* The invitation link is shown once — the server keeps only its hash. */}
      <CenterDialog
        visible={!!sentInvite}
        onDismiss={() => setSentInvite(null)}
        title={t('invites.sentTitle')}
      >
        <Text style={styles.sentTo}>{sentInvite?.email}</Text>
        <Text style={styles.qrHint}>{t('invites.sentHint')}</Text>
        <View style={styles.sentActions}>
          <TouchableOpacity
            style={[styles.primaryBtn, styles.sentBtn]}
            onPress={() => sentInvite && share(t('invites.inviteMessage', {
              organization: organization?.name ?? '',
              url: sentInvite.url,
            }))}
          >
            <Text style={styles.primaryBtnText}>{t('invites.shareLink')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.outlineBtn, styles.sentBtn]}
            onPress={() => sentInvite && copy(sentInvite.url)}
          >
            <Text style={styles.outlineBtnText}>{t('invites.copyLink')}</Text>
          </TouchableOpacity>
        </View>
      </CenterDialog>
    </View>
  );
}

function LinkAction({
  icon,
  label,
  onPress,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  tone?: 'danger';
}) {
  const color = tone === 'danger' ? colors.error : colors.text;
  return (
    <TouchableOpacity style={styles.linkAction} onPress={onPress} accessibilityRole="button">
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[styles.linkActionText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function RequestRow({
  request,
  busy,
  onDecide,
}: {
  request: JoinRequest;
  busy: boolean;
  onDecide: (decision: 'approve' | 'reject') => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.pendingCard}>
      <View style={styles.pendingHead}>
        <Avatar name={request.name} size={38} />
        <View style={styles.settingText}>
          <Text style={styles.pendingName} numberOfLines={1}>{request.name}</Text>
          <Text style={styles.pendingMeta} numberOfLines={1}>{request.email}</Text>
          <Text style={styles.pendingMeta} numberOfLines={1}>{request.phone}</Text>
        </View>
      </View>
      {request.message ? <Text style={styles.pendingMessage}>“{request.message}”</Text> : null}
      <Text style={styles.pendingMeta}>
        {t('invites.askedOn', { date: formatDate(request.createdAt, { day: 'numeric', month: 'short' }) })}
      </Text>
      <View style={styles.pendingActions}>
        <TouchableOpacity
          style={[styles.outlineBtn, styles.pendingBtn]}
          onPress={() => onDecide('reject')}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={styles.outlineBtnText}>{t('invites.reject')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryBtn, styles.pendingBtn]}
          onPress={() => onDecide('approve')}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={styles.primaryBtnText}>{t('invites.approve')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function InviteRow({
  invite,
  busy,
  onRevoke,
}: {
  invite: OrganizationInvite;
  busy: boolean;
  onRevoke: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.pendingCard}>
      <View style={styles.pendingHead}>
        <View style={styles.mailIcon}>
          <Ionicons name="mail-outline" size={18} color={colors.primary} />
        </View>
        <View style={styles.settingText}>
          <Text style={styles.pendingName} numberOfLines={1}>{invite.email}</Text>
          <Text style={styles.pendingMeta}>
            {t('invites.invitedBy', { name: invite.invitedByName })}
          </Text>
        </View>
        <StatusChip label={t('invites.status.pending')} color="#F59E0B" />
      </View>
      <View style={styles.pendingActions}>
        <Text style={[styles.pendingMeta, styles.expiry]}>
          {t('invites.expiresOn', {
            date: formatDate(invite.expiresAt, { day: 'numeric', month: 'short' }),
          })}
        </Text>
        <TouchableOpacity
          style={[styles.outlineBtn, styles.revokeBtn]}
          onPress={onRevoke}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={[styles.outlineBtnText, { color: colors.error }]}>
            {t('invites.withdraw')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  loading: { marginVertical: spacing.lg },
  orgCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    margin: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  orgText: { flex: 1, minWidth: 0 },
  orgName: { fontSize: 16.5, fontWeight: '800', color: colors.text },
  orgHint: { fontSize: 12.5, color: colors.textSecondary, marginTop: 2 },
  sectionTitle: {
    fontSize: 12.5,
    fontWeight: '800',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: spacing.md + 4,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  card: {
    marginHorizontal: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  code: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 3,
    color: colors.text,
    textAlign: 'center',
  },
  url: { fontSize: 12.5, color: colors.primary, textAlign: 'center', marginTop: 4 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.md },
  linkAction: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13 },
  linkActionText: { fontSize: 15.5 },
  emptyLink: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.md },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  settingText: { flex: 1, minWidth: 0 },
  settingLabel: { fontSize: 15, fontWeight: '700', color: colors.text },
  settingHint: { fontSize: 12.5, color: colors.textSecondary, marginTop: 2, lineHeight: 18 },
  roleRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  roleChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: borderRadius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  roleChipActive: { borderColor: colors.primary, backgroundColor: `${colors.primary}12` },
  roleChipText: { fontSize: 13.5, fontWeight: '700', color: colors.textSecondary },
  roleChipTextActive: { color: colors.primary },
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  emailInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14.5,
    color: colors.text,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnOff: { opacity: 0.4 },
  paneTabs: { paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  pendingCard: {
    marginHorizontal: spacing.md,
    marginBottom: 10,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  pendingHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mailIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: `${colors.primary}12`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingName: { fontSize: 15, fontWeight: '700', color: colors.text },
  pendingMeta: { fontSize: 12.5, color: colors.textSecondary },
  pendingMessage: { fontSize: 13.5, color: colors.text, fontStyle: 'italic' },
  pendingActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pendingBtn: { flex: 1 },
  expiry: { flex: 1 },
  revokeBtn: { borderColor: `${colors.error}55`, paddingHorizontal: 16 },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '700' },
  outlineBtn: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.full,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineBtnText: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  addDirectly: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    margin: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addDirectlyLabel: { fontSize: 15, fontWeight: '700', color: colors.primary },
  qrWrap: {
    alignSelf: 'center',
    padding: spacing.md,
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.lg,
  },
  qrCode: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 2,
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  qrHint: {
    fontSize: 12.5,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  sentTo: { fontSize: 15.5, fontWeight: '700', color: colors.text, textAlign: 'center' },
  sentActions: { flexDirection: 'row', gap: spacing.sm },
  sentBtn: { flex: 1 },
});
