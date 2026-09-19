import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, borderRadius } from '../../theme';
import { StatusChip } from '../ui';
import { formatDate, formatTime } from '../../utils/format';
import type { LeadTransfer, LeadTransferStatus } from '../../types';
import type { TransferDecision } from '../../services/leadTransfer.service';

const STATUS_COLOR: Record<LeadTransferStatus, string> = {
  pending: '#F59E0B',
  accepted: '#10B981',
  declined: '#EF4444',
  cancelled: '#6B7280',
  expired: '#9CA3AF',
};

interface Props {
  transfer: LeadTransfer;
  viewerId: string;
  isOrganizer: boolean;
  onDecide: (transfer: LeadTransfer, decision: TransferDecision) => void;
  /** Present only when the viewer can open the lead now. */
  onOpenLead?: () => void;
}

function when(iso: string | undefined): string {
  if (!iso) return '';
  return `${formatDate(iso, { day: 'numeric', month: 'short' }) ?? ''}, ${formatTime(iso) ?? ''}`;
}

/**
 * One transfer request: which lead, from whom to whom, why, and where it stands.
 *
 * The buttons follow the server's rule rather than restating it loosely: the
 * recipient answers, the sender withdraws, an organizer answers anyone's. A
 * button that the API would refuse is not drawn — and the API refuses it anyway.
 */
export function TransferCard({ transfer, viewerId, isOrganizer, onDecide, onOpenLead }: Props) {
  const { t } = useTranslation();
  const pending = transfer.status === 'pending';
  const isRecipient = transfer.toUser === viewerId;
  const isSender = transfer.requestedBy === viewerId || transfer.fromUser === viewerId;
  const canAnswer = pending && (isRecipient || (isOrganizer && !isSender));
  const canWithdraw = pending && isSender && !isRecipient;
  const onBehalf = transfer.requestedBy !== transfer.fromUser;

  const body = (
    <View style={styles.body}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <Ionicons name="swap-horizontal" size={18} color={colors.primary} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.contact} numberOfLines={1}>{transfer.contactName}</Text>
          <Text style={styles.number}>{transfer.leadNumber}</Text>
        </View>
        <StatusChip
          label={t(`transfers.status.${transfer.status}`)}
          color={STATUS_COLOR[transfer.status]}
        />
      </View>

      <View style={styles.route}>
        <View style={styles.party}>
          <Text style={styles.partyLabel}>{t('transfers.from')}</Text>
          <Text style={styles.partyName} numberOfLines={1}>{transfer.fromUserName}</Text>
        </View>
        <Ionicons name="arrow-forward" size={16} color={colors.textSecondary} />
        <View style={[styles.party, styles.partyEnd]}>
          <Text style={styles.partyLabel}>{t('transfers.to')}</Text>
          <Text style={styles.partyName} numberOfLines={1}>{transfer.toUserName}</Text>
        </View>
      </View>

      {transfer.reason ? (
        <View style={styles.quote}>
          <Text style={styles.quoteLabel}>{t('transfers.reason')}</Text>
          <Text style={styles.quoteText}>{transfer.reason}</Text>
        </View>
      ) : null}

      {transfer.decisionNote ? (
        <View style={styles.quote}>
          <Text style={styles.quoteLabel}>{t('transfers.note')}</Text>
          <Text style={styles.quoteText}>{transfer.decisionNote}</Text>
        </View>
      ) : null}

      <View style={styles.meta}>
        <Text style={styles.metaText}>{t('transfers.requestedOn', { date: when(transfer.createdAt) })}</Text>
        {onBehalf ? (
          <Text style={styles.metaText}>{t('transfers.requestedBy', { name: transfer.requestedByName })}</Text>
        ) : null}
        {pending ? (
          <Text style={[styles.metaText, styles.expires]}>
            {t('transfers.expiresOn', { date: when(transfer.expiresAt) })}
          </Text>
        ) : transfer.closeReason ? (
          <Text style={styles.metaText}>{t(`transfers.closeReason.${transfer.closeReason}`)}</Text>
        ) : transfer.decidedByName ? (
          <Text style={styles.metaText}>
            {t('transfers.decidedBy', {
              status: t(`transfers.status.${transfer.status}`),
              name: transfer.decidedByName,
              date: when(transfer.decidedAt),
            })}
          </Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={styles.card}>
      {onOpenLead ? (
        <TouchableOpacity onPress={onOpenLead} activeOpacity={0.75} accessibilityRole="button">
          {body}
        </TouchableOpacity>
      ) : (
        body
      )}

      {canAnswer ? (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.btn, styles.outlineBtn]}
            onPress={() => onDecide(transfer, 'decline')}
            accessibilityRole="button"
          >
            <Text style={styles.outlineText}>{t('transfers.decline')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.primaryBtn]}
            onPress={() => onDecide(transfer, 'accept')}
            accessibilityRole="button"
          >
            <Ionicons name="checkmark" size={16} color="#FFFFFF" />
            <Text style={styles.primaryText}>{t('transfers.accept')}</Text>
          </TouchableOpacity>
        </View>
      ) : canWithdraw ? (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.btn, styles.outlineBtn]}
            onPress={() => onDecide(transfer, 'cancel')}
            accessibilityRole="button"
          >
            <Ionicons name="arrow-undo" size={15} color={colors.error} />
            <Text style={[styles.outlineText, { color: colors.error }]}>{t('transfers.withdraw')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: 10,
    gap: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: `${colors.primary}12`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, minWidth: 0 },
  contact: { fontSize: 15.5, fontWeight: '700', color: colors.text },
  number: { fontSize: 12.5, color: colors.textSecondary, marginTop: 1 },
  route: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.lg,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  party: { flex: 1, minWidth: 0 },
  partyEnd: { alignItems: 'flex-end' },
  partyLabel: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase' },
  partyName: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 1 },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: `${colors.primary}40`,
    paddingLeft: 10,
  },
  quoteLabel: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase' },
  quoteText: { fontSize: 14, color: colors.text, lineHeight: 20, marginTop: 2 },
  body: { gap: 10 },
  meta: { gap: 2 },
  metaText: { fontSize: 12.5, color: colors.textSecondary },
  expires: { color: '#B45309' },
  actions: { flexDirection: 'row', gap: 10 },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: borderRadius.full,
    paddingVertical: 11,
  },
  outlineBtn: { borderWidth: 1.5, borderColor: colors.border },
  outlineText: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  primaryBtn: { backgroundColor: colors.primary },
  primaryText: { fontSize: 14.5, fontWeight: '700', color: '#FFFFFF' },
});
