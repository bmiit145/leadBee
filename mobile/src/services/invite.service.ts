import api, { apiErrorCode } from './api';
import { storage } from '../utils/storage';
import {
  ApiResponse,
  InvitePreview,
  Organization,
  User,
  InviteRole,
  InviteStatus,
  JoinLink,
  JoinRequest,
  JoinRequestStatus,
  OrganizationInvite,
  PaginatedResponse,
} from '../types';

/** Where an invite link points. The path a joiner pastes back into the app. */
const JOIN_BASE_URL = 'https://leadbee.app/join';

/** Stable `error.code`s the API answers invites with. */
export const INVITE_ERROR = {
  INVALID: 'INVITE_INVALID',
  REQUEST_PENDING: 'JOIN_REQUEST_PENDING',
  ALREADY_MEMBER: 'ALREADY_A_MEMBER',
  EMAIL_MISMATCH: 'INVITE_EMAIL_MISMATCH',
  NOT_PENDING: 'JOIN_REQUEST_NOT_PENDING',
  JOIN_CLOSED: 'JOIN_CLOSED',
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
} as const;

/** The translation key for a failed invite call, by its stable code. */
export function inviteErrorKey(error: unknown): string {
  switch (apiErrorCode(error)) {
    case INVITE_ERROR.INVALID:
      return 'invites.errors.invalid';
    case INVITE_ERROR.REQUEST_PENDING:
      return 'invites.errors.requestPending';
    case INVITE_ERROR.ALREADY_MEMBER:
      return 'invites.errors.alreadyMember';
    case INVITE_ERROR.EMAIL_MISMATCH:
      return 'invites.errors.emailMismatch';
    case INVITE_ERROR.NOT_PENDING:
      return 'invites.errors.notPending';
    case INVITE_ERROR.JOIN_CLOSED:
      return 'invites.errors.joinClosed';
    case INVITE_ERROR.ACCOUNT_NOT_FOUND:
      return 'invites.errors.accountNotFound';
    default:
      return 'invites.errors.failed';
  }
}

export function joinUrlFor(code: string): string {
  return `${JOIN_BASE_URL}/${code}`;
}

/** Where an emailed invitation points. Carries the token, so it is shared once. */
/**
 * The token out of an invitation link, or the whole string when someone pasted
 * the token by itself. `#` keeps it out of server logs and browser history
 * wherever the link is opened.
 */
export function tokenFromInviteLink(input: string): string {
  const trimmed = input.trim();
  const marked = trimmed.split('#').pop() ?? trimmed;
  return marked.split(/[?&/]/).filter(Boolean).pop() ?? trimmed;
}

interface LinkSettings {
  role?: InviteRole;
  /** `null` means it never lapses. */
  expiresInDays?: number | null;
  maxUses?: number | null;
}

/** Admin side: the link, invitations, and the queue of people asking to join. */
export const inviteService = {
  async getJoinSettings(): Promise<{ requireApproval: boolean; allowLinkJoin: boolean }> {
    const res = await api.get<ApiResponse<{ requireApproval: boolean; allowLinkJoin: boolean }>>('/invites/settings');
    return res.data.data;
  },

  async updateJoinSettings(settings: Partial<{ requireApproval: boolean; allowLinkJoin: boolean }>) {
    const res = await api.patch<ApiResponse<{ requireApproval: boolean; allowLinkJoin: boolean }>>('/invites/settings', settings);
    return res.data.data;
  },

  async addMemberByEmail(email: string): Promise<User> {
    const res = await api.post<ApiResponse<User>>('/invites/members', { email: email.trim().toLowerCase() });
    return res.data.data;
  },

  async getLink(): Promise<JoinLink | null> {
    const res = await api.get<ApiResponse<{ link: JoinLink | null }>>('/invites/link');
    return res.data.data.link;
  },

  /** Also "Reset link": any previous code is retired. */
  async issueLink(settings: LinkSettings = {}): Promise<JoinLink> {
    const res = await api.post<ApiResponse<{ link: JoinLink }>>('/invites/link', settings);
    return res.data.data.link;
  },

  async updateLink(settings: LinkSettings): Promise<JoinLink> {
    const res = await api.patch<ApiResponse<{ link: JoinLink }>>('/invites/link', settings);
    return res.data.data.link;
  },

  async turnLinkOff(): Promise<void> {
    await api.delete('/invites/link');
  },

  async listInvites(status?: InviteStatus): Promise<PaginatedResponse<OrganizationInvite>> {
    const res = await api.get<PaginatedResponse<OrganizationInvite>>('/invites', {
      params: { limit: 50, ...(status ? { status } : {}) },
    });
    return res.data;
  },

  async revokeInvite(id: string): Promise<void> {
    await api.delete(`/invites/${id}`);
  },

  async listRequests(status?: JoinRequestStatus): Promise<PaginatedResponse<JoinRequest>> {
    const res = await api.get<PaginatedResponse<JoinRequest>>('/invites/requests', {
      params: { limit: 50, ...(status ? { status } : {}) },
    });
    return res.data;
  },

  async pendingCounts(): Promise<{ requests: number; invites: number }> {
    const res = await api.get<ApiResponse<{ requests: number; invites: number }>>(
      '/invites/pending-count'
    );
    return res.data.data;
  },

  async decideRequest(
    id: string,
    decision: 'approve' | 'reject',
    role?: InviteRole
  ): Promise<JoinRequest> {
    const res = await api.post<ApiResponse<JoinRequest>>(
      `/invites/requests/${id}/${decision}`,
      role ? { role } : {}
    );
    return res.data.data;
  },
};

/** The session a join or an acceptance answers with — the sign-in shape. */
interface JoinedPayload {
  status: 'joined';
  user: User;
  organization: Organization;
  accessToken: string;
  refreshToken: string;
}

interface RequestedPayload {
  status: 'requested';
  request: JoinRequest;
  organizationName: string;
}

/** Joined and now in the organization, or queued for an admin to answer. */
export type JoinResult =
  | { status: 'joined'; user: User; organization: Organization }
  | { status: 'requested'; organizationName: string; request: JoinRequest };

/**
 * The tenant tokens replace the account session, exactly as creating an
 * organization does: the API has already ended the account session, so keeping
 * its tokens would leave the app holding one that no longer works.
 */
async function adopt(payload: JoinedPayload): Promise<JoinResult> {
  if (!payload.accessToken || !payload.refreshToken) {
    throw new Error('Missing tokens in response');
  }
  await storage.setTokens(payload.accessToken, payload.refreshToken, 'tenant');
  return { status: 'joined', user: payload.user, organization: payload.organization };
}

/** The joining side, used while the person still has only an account session. */
export const joinService = {
  async preview(code: string): Promise<InvitePreview> {
    const route = (await storage.getSessionKind()) === 'account' ? '/join/preview' : '/invites/join/preview';
    const res = await api.get<ApiResponse<InvitePreview>>(route, { params: { code } });
    return res.data.data;
  },

  async join(code: string, message?: string): Promise<JoinResult> {
    const route = (await storage.getSessionKind()) === 'account' ? '/join' : '/invites/join';
    const res = await api.post<ApiResponse<JoinedPayload | RequestedPayload>>(route, {
      code,
      ...(message ? { message } : {}),
    });
    const payload = res.data.data;
    return payload.status === 'joined'
      ? adopt(payload)
      : {
          status: 'requested',
          organizationName: payload.organizationName,
          request: payload.request,
        };
  },

  async accept(token: string): Promise<JoinResult> {
    const res = await api.post<ApiResponse<JoinedPayload>>('/join/accept', { token });
    return adopt(res.data.data);
  },

  async myInvitations(): Promise<OrganizationInvite[]> {
    const res = await api.get<ApiResponse<OrganizationInvite[]>>('/join/invitations');
    return res.data.data;
  },

  async myRequests(): Promise<JoinRequest[]> {
    const res = await api.get<ApiResponse<JoinRequest[]>>('/join/requests');
    return res.data.data;
  },

  async cancelRequest(id: string): Promise<void> {
    await api.delete(`/join/requests/${id}`);
  },
};
