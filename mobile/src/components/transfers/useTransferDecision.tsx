import React, { useState } from 'react';
import { Alert } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { queryKeys } from '../../lib/queryKeys';
import {
  leadTransferService,
  transferErrorKey,
  type TransferDecision,
} from '../../services/leadTransfer.service';
import { tapFeedback, warningFeedback } from '../../utils/haptics';
import { TransferDecisionSheet } from './TransferDecisionSheet';
import type { LeadTransfer } from '../../types';

interface Asking {
  transfer: LeadTransfer;
  decision: TransferDecision;
}

const ICON: Record<TransferDecision, keyof typeof Ionicons.glyphMap> = {
  accept: 'checkmark-circle',
  decline: 'close-circle',
  cancel: 'arrow-undo',
};

const TOAST: Record<TransferDecision, string> = {
  accept: 'transfers.decide.acceptedToast',
  decline: 'transfers.decide.declinedToast',
  cancel: 'transfers.decide.withdrawnToast',
};

/**
 * Accept, decline or withdraw a transfer, behind one confirmation sheet.
 *
 * Shared by the Transfer Requests screen and the lead page, so the same
 * decision reads and behaves the same wherever it is made.
 */
export function useTransferDecision(): {
  ask: (transfer: LeadTransfer, decision: TransferDecision) => void;
  sheet: React.ReactElement | null;
} {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [asking, setAsking] = useState<Asking | null>(null);

  const mutation = useMutation({
    mutationFn: ({ transfer, decision, note }: Asking & { note?: string }) =>
      leadTransferService.decide(transfer._id, decision, note),
    onSuccess: (_result, { decision }) => {
      tapFeedback();
      setAsking(null);
      Alert.alert(t('common.success'), t(TOAST[decision]));
    },
    onError: (error) => {
      warningFeedback();
      setAsking(null);
      Alert.alert(t('common.error'), t(transferErrorKey(error)));
    },
    // Either way the request's state has moved on (or turned out to have), so
    // lists, badges and the lead itself are re-read rather than patched.
    onSettled: (_result, _error, { transfer }) => {
      qc.invalidateQueries({ queryKey: queryKeys.leads.all });
      qc.invalidateQueries({ queryKey: queryKeys.leads.detail(transfer.lead) });
      qc.invalidateQueries({ queryKey: queryKeys.leads.thread(transfer.lead, 'timeline') });
    },
  });

  const copy = asking ? copyFor(asking, t) : null;

  const sheet =
    asking && copy ? (
      <TransferDecisionSheet
        visible
        onDismiss={() => !mutation.isPending && setAsking(null)}
        onConfirm={(note) => mutation.mutate({ ...asking, note })}
        title={copy.title}
        message={copy.message}
        confirmLabel={copy.confirm}
        icon={ICON[asking.decision]}
        tone={asking.decision === 'accept' ? 'primary' : 'danger'}
        loading={mutation.isPending}
      />
    ) : null;

  return { ask: (transfer, decision) => setAsking({ transfer, decision }), sheet };
}

function copyFor(
  { transfer, decision }: Asking,
  t: (key: string, options?: Record<string, unknown>) => string
): { title: string; message: string; confirm: string } {
  switch (decision) {
    case 'accept':
      return {
        title: t('transfers.decide.acceptTitle'),
        message: t('transfers.decide.acceptMessage', {
          contact: transfer.contactName,
          number: transfer.leadNumber,
        }),
        confirm: t('transfers.accept'),
      };
    case 'decline':
      return {
        title: t('transfers.decide.declineTitle'),
        message: t('transfers.decide.declineMessage', { name: transfer.fromUserName }),
        confirm: t('transfers.decline'),
      };
    case 'cancel':
      return {
        title: t('transfers.decide.withdrawTitle'),
        message: t('transfers.decide.withdrawMessage', { name: transfer.toUserName }),
        confirm: t('transfers.withdraw'),
      };
  }
}
