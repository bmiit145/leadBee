import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { colors, spacing, borderRadius } from '../../theme';
import { queryKeys } from '../../lib/queryKeys';
import { leadTransferService } from '../../services/leadTransfer.service';
import { formatDate } from '../../utils/format';
import { useTransferDecision } from './useTransferDecision';

interface Props {
  leadId: string;
  viewerId: string;
  isOrganizer: boolean;
}

/**
 * Says, on the lead itself, that it is on its way to someone else — so the
 * owner does not keep working a customer they have already handed over, and
 * can take the request back from here.
 *
 * Renders nothing when there is no open request, or while that is being checked.
 */
export function PendingTransferBanner({ leadId, viewerId, isOrganizer }: Props) {
  const { t } = useTranslation();
  const { ask, sheet } = useTransferDecision();

  const { data } = useQuery({
    queryKey: queryKeys.transfers.forLead(leadId),
    queryFn: () => leadTransferService.forLead(leadId),
  });

  const open = data?.open;
  if (!open) return sheet;

  const isSender = open.requestedBy === viewerId || open.fromUser === viewerId;
  const canWithdraw = isSender || isOrganizer;

  return (
    <>
      <View style={styles.banner} accessibilityRole="summary">
        <Ionicons name="swap-horizontal" size={18} color="#B45309" />
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={2}>
            {t('transfers.banner.pending', { name: open.toUserName })}
          </Text>
          <Text style={styles.sub}>
            {t('transfers.banner.expires', {
              date: formatDate(open.expiresAt, { day: 'numeric', month: 'short' }),
            })}
          </Text>
        </View>
        {canWithdraw ? (
          <TouchableOpacity
            style={styles.action}
            onPress={() => ask(open, 'cancel')}
            accessibilityRole="button"
          >
            <Text style={styles.actionText}>{t('transfers.withdraw')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {sheet}
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: borderRadius.lg,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 13.5, fontWeight: '700', color: '#78350F' },
  sub: { fontSize: 12, color: '#92400E', marginTop: 1 },
  action: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: borderRadius.full,
    borderWidth: 1.5,
    borderColor: '#B45309',
  },
  actionText: { fontSize: 13, fontWeight: '700', color: '#B45309' },
});
