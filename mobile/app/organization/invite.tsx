import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Share,
  Linking,
  Platform,
  ToastAndroid,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
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
import { InlineFeedback } from '../../src/components/ui/InlineFeedback';
import type { SegmentedTab } from '../../src/components/ui';
import { queryKeys } from '../../src/lib/queryKeys';
import {
  inviteService,
  inviteErrorKey,
  joinUrlFor,
} from '../../src/services/invite.service';
import { useAuth } from '../../src/stores/auth.store';
import { formatDate } from '../../src/utils/format';
import { isValidEmail } from '../../src/utils/validators';
import { tapFeedback, warningFeedback } from '../../src/utils/haptics';
import type { JoinRequest, OrganizationInvite } from '../../src/types';

type Pane = 'requests' | 'invitations';
type QrCodeHandle = { toDataURL: (callback: (data: string) => void) => void };
type QrSaveFeedback =
  | { kind: 'success' }
  | { kind: 'error' }
  | { kind: 'permission'; canAskAgain: boolean }
  | null;

/**
 * WhatsApp-style "Group link" invite hub.
 *
 * Provides a direct invite link, QR code, forward to WhatsApp, send via SMS,
 * system share, reset link, direct email invitations and pending join requests.
 */
export default function InviteMembersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { organization, hasPermission } = useAuth();
  const canManageMembers = hasPermission('users.manage');

  const [pane, setPane] = useState<Pane>('requests');
  const [email, setEmail] = useState('');
  const [qrOpen, setQrOpen] = useState(false);
  const [qrSavePending, setQrSavePending] = useState(false);
  const [qrSaveFeedback, setQrSaveFeedback] = useState<QrSaveFeedback>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const qrRef = useRef<QrCodeHandle | null>(null);

  // The drawer hides this destination from members, but deep links and
  // notifications can still open a file-based route directly.
  useEffect(() => {
    if (!canManageMembers) router.replace('/(leads)');
  }, [canManageMembers, router]);

  const linkQuery = useQuery({
    queryKey: queryKeys.invites.link,
    queryFn: inviteService.getLink,
    enabled: canManageMembers,
  });
  const requestsQuery = useQuery({
    queryKey: queryKeys.invites.requests('pending'),
    queryFn: () => inviteService.listRequests('pending'),
    enabled: canManageMembers,
  });
  const invitesQuery = useQuery({
    queryKey: queryKeys.invites.list('pending'),
    queryFn: () => inviteService.listInvites('pending'),
    enabled: canManageMembers,
  });
  const settingsQuery = useQuery({
    queryKey: queryKeys.invites.settings,
    queryFn: inviteService.getJoinSettings,
    enabled: canManageMembers,
  });

  const link = linkQuery.data;
  const joinUrl = link ? joinUrlFor(link.code) : '';
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.invites.all });

  const fail = (error: unknown) => {
    warningFeedback();
    setActionFeedback({ kind: 'error', message: t(inviteErrorKey(error)) });
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
    mutationFn: inviteService.updateJoinSettings,
    onSuccess: () => {
      tapFeedback();
      refresh();
    },
    onError: fail,
  });

  const addMemberMutation = useMutation({
    mutationFn: () => inviteService.addMemberByEmail(email),
    onSuccess: (member) => {
      tapFeedback();
      setEmail('');
      void qc.invalidateQueries({ queryKey: queryKeys.users.all });
      setActionFeedback({
        kind: 'success',
        message: t('invites.memberAdded', { name: member.name, organization: organization?.name ?? '' }),
      });
    },
    onError: fail,
  });

  const decideMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) =>
      inviteService.decideRequest(id, decision),
    onSuccess: (_result, { decision }) => {
      tapFeedback();
      refresh();
      if (decision === 'approve') setActionFeedback({ kind: 'success', message: t('invites.approvedToast') });
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
    if (Platform.OS === 'android') {
      ToastAndroid.show(t('invites.copied'), ToastAndroid.SHORT);
    }
  };

  const saveQrToGallery = async () => {
    if (!qrRef.current || !joinUrl || qrSavePending) return;

    setQrSaveFeedback(null);
    setQrSavePending(true);
    let fileUri: string | undefined;
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) {
        warningFeedback();
        setQrSaveFeedback({ kind: 'permission', canAskAgain: permission.canAskAgain });
        return;
      }

      const dataUrl = await new Promise<string>((resolve) => {
        qrRef.current?.toDataURL(resolve);
      });
      if (!FileSystem.cacheDirectory) throw new Error('File cache is unavailable');
      fileUri = `${FileSystem.cacheDirectory}leadbee-invite-qr-${Date.now()}.png`;
      await FileSystem.writeAsStringAsync(fileUri, dataUrl, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await MediaLibrary.createAssetAsync(fileUri);
      tapFeedback();
      setQrSaveFeedback({ kind: 'success' });
    } catch {
      warningFeedback();
      setQrSaveFeedback({ kind: 'error' });
    } finally {
      try {
        if (fileUri) await FileSystem.deleteAsync(fileUri, { idempotent: true });
      } catch {
        // Temporary-file cleanup must not replace the save result shown to the user.
      } finally {
        setQrSavePending(false);
      }
    }
  };

  const openPermissionSettings = async () => {
    try {
      await Linking.openSettings();
    } catch {
      warningFeedback();
      setQrSaveFeedback({ kind: 'error' });
    }
  };

  const shareText = t('invites.shareMessage', {
    organization: organization?.name ?? '',
    url: joinUrl,
    code: link?.code ?? '',
  });

  const forwardWhatsApp = async () => {
    const url = `whatsapp://send?text=${encodeURIComponent(shareText)}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        await share(shareText);
      }
    } catch {
      await share(shareText);
    }
  };

  const sendSMS = async () => {
    const url = `sms:?body=${encodeURIComponent(shareText)}`;
    try {
      await Linking.openURL(url);
    } catch {
      await share(shareText);
    }
  };

  if (!canManageMembers) return null;

  const panes: SegmentedTab<Pane>[] = [
    { value: 'requests', label: t('invites.tabs.requests'), count: requestsQuery.data?.total ?? 0 },
    { value: 'invitations', label: t('invites.tabs.invitations'), count: invitesQuery.data?.total ?? 0 },
  ];

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={t('invites.linkTitle')}
        variant="white"
        titleAlign="left"
      />

      {actionFeedback ? (
        <InlineFeedback
          tone={actionFeedback.kind}
          title={t(actionFeedback.kind === 'success' ? 'common.success' : 'common.error')}
          message={actionFeedback.message}
          onDismiss={() => setActionFeedback(null)}
        />
      ) : null}

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Hero Group/Organization Card (WhatsApp Style) ─────────────── */}
        <View style={styles.heroRow}>
          <View style={styles.groupAvatar}>
            <Ionicons name="people" size={28} color="#6750A4" />
          </View>
          <View style={styles.heroInfo}>
            <Text style={styles.heroTitle} numberOfLines={1}>{organization?.name}</Text>
            {link ? (
              <Text
                style={styles.heroLink}
                numberOfLines={2}
                selectable
                onPress={() => copy(joinUrl)}
              >
                {joinUrl}
              </Text>
            ) : (
              <Text style={styles.heroLinkPending}>{t('invites.noLink')}</Text>
            )}
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.enterpriseSection}>
          <Text style={styles.enterpriseSectionTitle}>{t('invites.joinSettingsTitle')}</Text>
          {settingsQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} style={styles.loading} />
          ) : settingsQuery.isError ? (
            <EmptyState icon="cloud-offline-outline" title={t('invites.settingsLoadError')} actionLabel={t('common.tryAgain')} onAction={() => void settingsQuery.refetch()} />
          ) : settingsQuery.data ? (
            <>
              <View style={styles.settingRow}>
                <View style={styles.settingText}>
                  <Text style={styles.settingTitle}>{t('invites.approvalSetting')}</Text>
                  <Text style={styles.settingHint}>{t('invites.approvalHint')}</Text>
                </View>
                <Switch
                  value={settingsQuery.data.requireApproval}
                  onValueChange={(requireApproval) => settingsMutation.mutate({ requireApproval })}
                  disabled={settingsMutation.isPending}
                  accessibilityLabel={t('invites.approvalSetting')}
                />
              </View>
              <View style={styles.settingRow}>
                <View style={styles.settingText}>
                  <Text style={styles.settingTitle}>{t('invites.linkJoinSetting')}</Text>
                  <Text style={styles.settingHint}>{t(settingsQuery.data.allowLinkJoin ? 'invites.linkJoinOnHint' : 'invites.linkJoinOffHint')}</Text>
                </View>
                <Switch
                  value={settingsQuery.data.allowLinkJoin}
                  onValueChange={(allowLinkJoin) => settingsMutation.mutate({ allowLinkJoin })}
                  disabled={settingsMutation.isPending}
                  accessibilityLabel={t('invites.linkJoinSetting')}
                />
              </View>
            </>
          ) : null}
        </View>

        {/* ─── Action Rows (WhatsApp Group link Style) ─────────────────────── */}
        {linkQuery.isLoading || settingsQuery.isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : settingsQuery.isError ? (
          <EmptyState icon="cloud-offline-outline" title={t('invites.settingsLoadError')} actionLabel={t('common.tryAgain')} onAction={() => void settingsQuery.refetch()} />
        ) : settingsQuery.data?.allowLinkJoin === false ? (
          <View style={styles.closedCard}>
            <Ionicons name="lock-closed-outline" size={26} color={colors.textSecondary} />
            <Text style={styles.closedTitle}>{t('invites.linkJoinLocked')}</Text>
            <Text style={styles.closedHint}>{t('invites.linkJoinOffHint')}</Text>
          </View>
        ) : !link ? (
          <View style={styles.emptyLinkCard}>
            <View style={styles.emptyLinkHeader}>
              <View style={styles.emptyLinkIcon}>
                <Ionicons name="link-outline" size={22} color={colors.primary} />
              </View>
              <View style={styles.emptyLinkCopy}>
                <Text style={styles.emptyLinkTitle}>{t('invites.createLink')}</Text>
                <Text style={styles.emptyLinkHint}>{t('invites.noLink')}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.primaryBtn, issueMutation.isPending && styles.primaryBtnDisabled]}
              onPress={() => issueMutation.mutate()}
              disabled={issueMutation.isPending}
              accessibilityRole="button"
              accessibilityLabel={t('invites.createLink')}
              accessibilityState={{ busy: issueMutation.isPending, disabled: issueMutation.isPending }}
              activeOpacity={0.82}
            >
              {issueMutation.isPending ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <View style={styles.primaryBtnContent}>
                  <Ionicons name="add-circle-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryBtnText}>{t('invites.createLink')}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.actionsList}>
            <ActionRow
              icon="copy-outline"
              label={t('invites.copyLink')}
              onPress={() => copy(joinUrl)}
            />
            <ActionRow
              icon="arrow-redo-outline"
              label={t('invites.whatsappLink')}
              onPress={forwardWhatsApp}
            />
            <ActionRow
              icon="chatbox-outline"
              label={t('invites.smsLink')}
              onPress={sendSMS}
            />
            <ActionRow
              icon="share-social-outline"
              label={t('invites.shareLink')}
              onPress={() => share(shareText)}
            />
            <ActionRow
              icon="qr-code-outline"
              label={t('invites.qrCode')}
              onPress={() => setQrOpen(true)}
            />
            <ActionRow
              icon="remove-circle-outline"
              label={t('invites.resetLink')}
              tone="danger"
              onPress={() => setResetOpen(true)}
            />
          </View>
        )}

        <View style={styles.sectionSpacer} />

        {/* ─── Add a registered person by email ──────────────────────────── */}
        <View style={styles.enterpriseSection}>
          <Text style={styles.enterpriseSectionTitle}>{t('invites.addByEmailTitle')}</Text>
          <Text style={styles.enterpriseHint}>{t('invites.addByEmailHint')}</Text>
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
              onPress={() => addMemberMutation.mutate()}
              disabled={!isValidEmail(email) || addMemberMutation.isPending}
              accessibilityRole="button"
              accessibilityLabel={t('invites.addMember')}
            >
              {addMemberMutation.isPending ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Ionicons name="person-add" size={17} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* ─── Waiting on Admin Queue (Enterprise Feature) ────────────────── */}
        <View style={styles.enterpriseSection}>
          <Text style={styles.enterpriseSectionTitle}>{t('invites.pendingTitle')}</Text>
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
        </View>
      </ScrollView>

      {/* ─── QR Code Modal ──────────────────────────────────────────────── */}
      <CenterDialog visible={qrOpen} onDismiss={() => setQrOpen(false)} title={t('invites.qrTitle')}>
        <View style={styles.qrWrap}>
          {joinUrl ? (
            <QRCode
              value={joinUrl}
              size={196}
              backgroundColor="#FFFFFF"
              getRef={(ref) => {
                qrRef.current = ref as unknown as QrCodeHandle | null;
              }}
            />
          ) : null}
        </View>
        <Text style={styles.qrCode} selectable>{link?.code}</Text>
        <Text style={styles.qrHint}>{t('invites.qrHint')}</Text>
        {qrSaveFeedback ? (
          <>
            <InlineFeedback
              tone={qrSaveFeedback.kind === 'success' ? 'success' : 'error'}
              title={t(qrSaveFeedback.kind === 'success' ? 'common.success' : 'common.error')}
              message={t(
                qrSaveFeedback.kind === 'success'
                  ? 'invites.qrSaved'
                  : qrSaveFeedback.kind === 'permission'
                    ? qrSaveFeedback.canAskAgain
                      ? 'invites.qrPermissionDenied'
                      : 'invites.qrPermissionSettings'
                    : 'invites.qrSaveError',
              )}
              onDismiss={() => setQrSaveFeedback(null)}
            />
            {qrSaveFeedback.kind === 'permission' && !qrSaveFeedback.canAskAgain ? (
              <TouchableOpacity
                style={styles.qrFeedbackAction}
                onPress={openPermissionSettings}
                accessibilityRole="button"
                accessibilityLabel={t('invites.openSettings')}
              >
                <Text style={styles.qrFeedbackActionText}>{t('invites.openSettings')}</Text>
              </TouchableOpacity>
            ) : qrSaveFeedback.kind !== 'success' ? (
              <TouchableOpacity
                style={styles.qrFeedbackAction}
                onPress={saveQrToGallery}
                disabled={qrSavePending}
                accessibilityRole="button"
                accessibilityLabel={t('common.tryAgain')}
                accessibilityState={{ busy: qrSavePending, disabled: qrSavePending }}
              >
                <Text style={styles.qrFeedbackActionText}>{t('common.tryAgain')}</Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : null}
        <View style={styles.qrActions}>
          <TouchableOpacity
            style={[styles.qrDownloadBtn, qrSavePending && styles.primaryBtnDisabled]}
            onPress={saveQrToGallery}
            disabled={qrSavePending}
            accessibilityRole="button"
            accessibilityLabel={t('invites.downloadQr')}
            accessibilityState={{ busy: qrSavePending, disabled: qrSavePending }}
          >
            {qrSavePending ? (
              <ActivityIndicator color={colors.text} size="small" />
            ) : (
              <Ionicons name="download-outline" size={20} color={colors.text} />
            )}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.primaryBtn, styles.qrShareBtn]} onPress={() => share(shareText)}>
            <Text style={styles.primaryBtnText}>{t('invites.shareLink')}</Text>
          </TouchableOpacity>
        </View>
      </CenterDialog>

      {/* ─── Reset Link Confirm Dialog ──────────────────────────────────── */}
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

    </View>
  );
}

function ActionRow({
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
  const isDanger = tone === 'danger';
  const color = isDanger ? '#EA0038' : '#1A1A1A';
  const iconColor = isDanger ? '#EA0038' : '#54656F';
  return (
    <TouchableOpacity
      style={styles.actionRow}
      onPress={onPress}
      accessibilityRole="button"
      activeOpacity={0.7}
    >
      <View style={styles.actionIconWrap}>
        <Ionicons name={icon} size={23} color={iconColor} />
      </View>
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
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
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  loading: { marginVertical: spacing.lg },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 18,
    backgroundColor: '#FFFFFF',
  },
  groupAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#ECE6F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroInfo: { flex: 1, minWidth: 0, marginLeft: 16 },
  settingText: { flex: 1, minWidth: 0 },
  heroTitle: { fontSize: 17, fontWeight: '700', color: '#1A1A1A' },
  heroLink: {
    fontSize: 14,
    color: '#008069',
    marginTop: 4,
    lineHeight: 19,
  },
  heroLinkPending: {
    fontSize: 13.5,
    color: colors.textSecondary,
    marginTop: 4,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E0E0E0',
  },
  actionsList: {
    backgroundColor: '#FFFFFF',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  actionIconWrap: {
    width: 32,
    alignItems: 'flex-start',
    marginRight: 16,
  },
  actionLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  sectionSpacer: {
    height: 10,
    backgroundColor: '#F7F7F8',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#ECECEC',
  },
  emptyLinkCard: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  settingTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  settingHint: { marginTop: 3, fontSize: 12.5, lineHeight: 18, color: colors.textSecondary },
  closedCard: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.md,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.lg,
  },
  closedTitle: { fontSize: 16, fontWeight: '700', color: colors.text, textAlign: 'center' },
  closedHint: { fontSize: 13, lineHeight: 19, color: colors.textSecondary, textAlign: 'center' },
  emptyLinkHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  emptyLinkIcon: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceVariant,
  },
  emptyLinkCopy: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  emptyLinkTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  emptyLinkHint: {
    marginTop: 3,
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  enterpriseSection: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 10,
    backgroundColor: '#FFFFFF',
  },
  enterpriseSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  enterpriseHint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 10,
    lineHeight: 18,
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  emailInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14.5,
    color: colors.text,
    backgroundColor: colors.surface,
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
  paneTabs: { marginBottom: spacing.sm },
  pendingCard: {
    marginBottom: 10,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
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
  pendingActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  pendingBtn: { flex: 1 },
  expiry: { flex: 1 },
  revokeBtn: { borderColor: `${colors.error}55`, paddingHorizontal: 16 },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    minHeight: 46,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: { opacity: 0.55 },
  primaryBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '700' },
  outlineBtn: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.full,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineBtnText: { fontSize: 14, fontWeight: '700', color: colors.text },
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
  qrFeedbackAction: {
    alignSelf: 'flex-end',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  qrFeedbackActionText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  qrActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  qrDownloadBtn: {
    width: 46,
    height: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  qrShareBtn: { flex: 1 },
  sentTo: { fontSize: 15.5, fontWeight: '700', color: colors.text, textAlign: 'center' },
  sentActions: { flexDirection: 'row', gap: spacing.sm },
  sentBtn: { flex: 1 },
});
