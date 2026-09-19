import api, { apiErrorCode } from './api';
import {
  ApiResponse,
  LeadTransfer,
  LeadTransferBox,
  LeadTransferStatus,
  PaginatedResponse,
  TransferRecipient,
} from '../types';

export type TransferDecision = 'accept' | 'decline' | 'cancel';

/** Stable `error.code`s the API answers transfer conflicts with. */
export const TRANSFER_ERROR = {
  PENDING: 'TRANSFER_PENDING',
  NOT_PENDING: 'TRANSFER_NOT_PENDING',
  STALE: 'TRANSFER_STALE',
  INVALID_RECIPIENT: 'TRANSFER_INVALID_RECIPIENT',
} as const;

/**
 * The translation key for a failed transfer call. Branches on the stable code,
 * never the English message, so the reply reads in the user's language.
 */
export function transferErrorKey(error: unknown): string {
  switch (apiErrorCode(error)) {
    case TRANSFER_ERROR.PENDING:
      return 'transfers.errors.pending';
    case TRANSFER_ERROR.NOT_PENDING:
      return 'transfers.errors.notPending';
    case TRANSFER_ERROR.STALE:
      return 'transfers.errors.stale';
    case TRANSFER_ERROR.INVALID_RECIPIENT:
      return 'transfers.errors.invalidRecipient';
    default:
      return 'transfers.errors.failed';
  }
}

export const leadTransferService = {
  /**
   * `completed` is true when the lead moved at once (an organizer's transfer),
   * false when it now waits for the recipient to accept.
   */
  async request(data: {
    leadId: string;
    toUserId: string;
    reason?: string;
  }): Promise<{ transfer: LeadTransfer; completed: boolean }> {
    const res = await api.post<ApiResponse<{ transfer: LeadTransfer; completed: boolean }>>(
      '/lead-transfers',
      data
    );
    return res.data.data;
  },

  async decide(id: string, decision: TransferDecision, note?: string): Promise<LeadTransfer> {
    const res = await api.post<ApiResponse<LeadTransfer>>(
      `/lead-transfers/${id}/${decision}`,
      note ? { note } : {}
    );
    return res.data.data;
  },

  async list(filters: {
    box: LeadTransferBox;
    status?: LeadTransferStatus;
    page: number;
    limit?: number;
  }): Promise<PaginatedResponse<LeadTransfer>> {
    const res = await api.get<PaginatedResponse<LeadTransfer>>('/lead-transfers', {
      params: { limit: 20, ...filters },
    });
    return res.data;
  },

  async pendingCount(): Promise<number> {
    const res = await api.get<ApiResponse<{ count: number }>>('/lead-transfers/pending-count');
    return res.data.data.count;
  },

  async forLead(leadId: string): Promise<{ open: LeadTransfer | null; history: LeadTransfer[] }> {
    const res = await api.get<ApiResponse<{ open: LeadTransfer | null; history: LeadTransfer[] }>>(
      `/lead-transfers/lead/${leadId}`
    );
    return res.data.data;
  },

  async recipients(search: string): Promise<TransferRecipient[]> {
    const res = await api.get<PaginatedResponse<TransferRecipient>>('/lead-transfers/recipients', {
      params: { limit: 50, ...(search ? { search } : {}) },
    });
    return res.data.data;
  },
};
