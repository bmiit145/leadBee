import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Account, User } from '../types';
import { authService } from '../services/auth.service';
import { onboardingService } from '../services/onboarding.service';
import { organizationsService } from '../services/organizations.service';
import { queryClient } from '../lib/queryClient';
import { storage, type SessionKind } from '../utils/storage';
import { systemService, ServerStatus } from '../services/system.service';
import { setForcedLogoutCallback, setOrgInactiveCallback } from '../services/api';
import { Organization } from '../types';

export type ViewMode = 'admin' | 'agent';
const VIEW_MODE_KEY = 'lead_view_mode';

const getEffectivePermissions = (user: User | null): string[] => {
  if (!user) return [];
  const directPermissions = Array.isArray(user.permissions) ? user.permissions : [];
  const rolePermissions = Array.isArray(user.roleId?.permissions) ? user.roleId.permissions : [];
  return Array.from(new Set([...directPermissions, ...rolePermissions]));
};

/** A refusal that ends a session, as opposed to the network having a bad moment. */
const isDefinitive = (status?: number) => status === 400 || status === 401 || status === 403;

interface AuthContextType {
  user: User | null;
  /** The tenant this session belongs to. Null before sign-in. */
  organization: Organization | null;
  /**
   * The signed-in person, when they belong to no organization yet. Null on a
   * membership session — `user` carries the person there.
   */
  account: Account | null;
  /** Signed in, but not a member of any organization: the "create or join" step. */
  isAccountSession: boolean;
  /** Set when the API reports the tenant is suspended or its trial lapsed.
   *  Distinct from a sign-in failure — the credentials are fine. */
  orgInactiveMessage: string | null;
  clearOrgInactive: () => void;
  /** A membership session. False on an account session. */
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  serverStatus: ServerStatus;
  isCheckingServer: boolean;
  isOrganizer: boolean;
  viewMode: ViewMode;
  switchViewMode: () => void;
  /**
   * `identifier` is an email or a mobile number. Resolves to the kind of
   * session opened, so the caller can route to the workspace or to the
   * no-organization screen.
   */
  login: (identifier: string, password: string, organizationId?: string) => Promise<SessionKind>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  reloadSession: () => Promise<void>;
  /**
   * Re-reads an account session. Resolves to how many organizations the person
   * now belongs to — above zero means someone added them since they signed in.
   */
  reloadAccount: () => Promise<number>;
  /**
   * Creates an organization owned by the signed-in person and switches to it —
   * from an account session (their first) or a membership (another one).
   * Afterwards `isAuthenticated` is true.
   */
  createOrganization: (details: { organizationName: string; slug?: string }) => Promise<void>;
  /**
   * Moves this device into another organization the person belongs to. Clears
   * everything cached for the one being left. Rejects with the API's error.
   */
  switchOrganization: (organizationId: string, organizationName: string) => Promise<void>;
  /** The organization being switched to, while a switch is in flight. */
  organizationTransition: string | null;
  checkServerHealth: () => Promise<ServerStatus>;
  /**
   * "Try again" on the server-down screen: checks the server and, once it
   * answers, restores the stored session.
   */
  retryServerConnection: () => Promise<ServerStatus>;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [organizationTransition, setOrganizationTransition] = useState<string | null>(null);
  const [orgInactiveMessage, setOrgInactiveMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatus>('checking');
  const [isCheckingServer, setIsCheckingServer] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('admin');
  const initializationAttempted = useRef(false);

  // Load persisted view mode on mount
  useEffect(() => {
    AsyncStorage.getItem(VIEW_MODE_KEY).then(val => {
      if (val === 'agent' || val === 'admin') setViewMode(val);
    });
  }, []);

  const clearSessionState = useCallback(() => {
    setUser(null);
    setOrganization(null);
    setAccount(null);
  }, []);

  const checkServerHealth = useCallback(async () => {
    try {
      setIsCheckingServer(true);
      const result = await systemService.getServerHealth();
      setServerStatus(result.status);
      return result.status;
    } catch {
      setServerStatus('unreachable');
      return 'unreachable' as ServerStatus;
    } finally {
      setIsCheckingServer(false);
    }
  }, []);

  /** Restores a stored account session, refreshing once if the access token is refused. */
  const restoreAccountSession = useCallback(async () => {
    try {
      setAccount((await authService.getAccountMe()).account);
    } catch (error: any) {
      if (!isDefinitive(error.response?.status)) {
        // Nothing cached to show, so this lands on sign-in; the stored tokens
        // are kept and the next launch tries again.
        console.warn('⚠️ Server unreachable, account session not restored');
        return;
      }
      try {
        await authService.refresh();
        setAccount((await authService.getAccountMe()).account);
      } catch (refreshError: any) {
        if (isDefinitive(refreshError?.response?.status)) {
          setAccount(null);
          await storage.clearTokens();
        }
      }
    }
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const [token, cachedUser, kind] = await Promise.all([
        storage.getAccessToken(),
        storage.getUser(),
        storage.getSessionKind(),
      ]);
      if (!token) { clearSessionState(); return; }

      if (kind === 'account') {
        await restoreAccountSession();
        return;
      }

      if (cachedUser) setUser(cachedUser);

      try {
        const session = await authService.getMe();
        setUser(session.user);
        setOrganization(session.organization);
        await storage.setUser(session.user);
      } catch (error: any) {
        const status = error.response?.status;
        if (isDefinitive(status)) {
          try {
            await authService.refresh();
            const session = await authService.getMe();
            setUser(session.user);
            setOrganization(session.organization);
            await storage.setUser(session.user);
          } catch (refreshError: any) {
            if (isDefinitive(refreshError?.response?.status)) {
              setUser(null); setOrganization(null);
              await storage.clearTokens();
            }
          }
        } else {
          // A 5xx or a timeout is the network's problem, not the session's.
          // Keeping the cached user lets the app stay usable when it comes back.
          console.warn('⚠️ Server unreachable (status: ' + status + '), keeping session');
        }
      }
    } catch {
      console.error('❌ Auth initialization error');
    }
  }, [clearSessionState, restoreAccountSession]);

  // Startup skips restoring the session while the server is unreachable, so
  // recovering has to restore it too. Checking health alone left a person who is
  // still validly signed in at the sign-in screen once the server came back.
  const retryServerConnection = useCallback(async () => {
    const status = await checkServerHealth();
    if (status === 'healthy') await checkAuth();
    return status;
  }, [checkServerHealth, checkAuth]);

  const refreshAuth = useCallback(async () => {
    try {
      setIsLoading(true);
      await authService.refresh();
      if ((await storage.getSessionKind()) === 'account') {
        setAccount((await authService.getAccountMe()).account);
        return;
      }
      const session = await authService.getMe();
      setUser(session.user);
      setOrganization(session.organization);
    } catch {
      clearSessionState();
      await storage.clearTokens();
    } finally {
      setIsLoading(false);
    }
  }, [clearSessionState]);

  /**
   * Re-reads the session from `/auth/me` without rotating tokens.
   *
   * Used after the user edits their own profile. The `PUT /auth/me` response is
   * not a substitute: it returns the user with `roleId` unpopulated, which would
   * silently drop role permissions from the client until the next sign-in.
   * Unlike `refreshAuth`, a failure here is left to the caller and never signs
   * the user out — the edit itself has already been saved.
   */
  const reloadSession = useCallback(async () => {
    const session = await authService.getMe();
    setUser(session.user);
    setOrganization(session.organization);
    await storage.setUser(session.user);
  }, []);

  const reloadAccount = useCallback(async () => {
    const me = await authService.getAccountMe();
    setAccount(me.account);
    return me.organizationCount;
  }, []);

  /**
   * Makes a membership session that the API has just issued the current one.
   *
   * Everything cached belongs to the organization being left, so it goes first:
   * queries are reset (their data dropped, active ones refetched with the new
   * tokens, which are already stored) and the saved project choice is cleared.
   * Otherwise the new organization would show the old one's leads for a frame —
   * or, for a query that is not refetched, until the app restarts.
   */
  const adoptMembershipSession = useCallback(
    async (session: { user: User; organization: Organization }) => {
      void queryClient.resetQueries();
      await storage.clearProjectCache();
      setAccount(null);
      setOrgInactiveMessage(null);
      setUser(session.user);
      setOrganization(session.organization);
      await storage.setUser(session.user);
    },
    []
  );

  const createOrganization = useCallback(
    async (details: { organizationName: string; slug?: string }) => {
      const onAccountSession = (await storage.getSessionKind()) === 'account';
      const session = onAccountSession
        ? await onboardingService.createOrganization(details)
        : await organizationsService.create(details);
      await adoptMembershipSession(session);
    },
    [adoptMembershipSession]
  );

  const switchOrganization = useCallback(
    async (organizationId: string, organizationName: string) => {
      setOrganizationTransition(organizationName);
      try {
        const session = await organizationsService.switchTo(organizationId);
        await adoptMembershipSession(session);
      } finally {
        setOrganizationTransition(null);
      }
    },
    [adoptMembershipSession]
  );

  const login = useCallback(
    async (identifier: string, password: string, organizationId?: string) => {
      try {
        setIsLoading(true);
        setOrgInactiveMessage(null);
        const result = await authService.login(identifier, password, organizationId);
        if (result.session === 'account') {
          setUser(null);
          setOrganization(null);
          setAccount(result.account);
          await storage.setUser(null);
        } else {
          setAccount(null);
          setUser(result.user);
          setOrganization(result.organization);
          await storage.setUser(result.user);
        }
        return result.session;
      } catch (error) {
        clearSessionState();
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [clearSessionState]
  );

  const logout = useCallback(async () => {
    try {
      setIsLoading(true);
      await authService.logout();
    } catch {
      // Ignored: the local session is cleared regardless.
    } finally {
      clearSessionState();
      setOrgInactiveMessage(null);
      await storage.clearTokens();
      // The next person to sign in on this device must not see this one's data.
      queryClient.clear();
      setIsLoading(false);
    }
  }, [clearSessionState]);

  const clearOrgInactive = useCallback(() => setOrgInactiveMessage(null), []);

  // Bridge the Axios interceptors into React state.
  useEffect(() => {
    setForcedLogoutCallback(async () => {
      clearSessionState();
      await storage.clearTokens();
    });

    // A suspended tenant is not an auth failure: the credentials are valid and
    // the account is fine. Clearing tokens would drop the user at a login
    // screen that rejects them with the same message and no explanation, so the
    // session is kept and a dedicated screen explains what happened.
    setOrgInactiveCallback((message: string) => {
      setOrgInactiveMessage(message);
    });
  }, [clearSessionState]);

  // Initialize auth on app startup (once)
  useEffect(() => {
    if (initializationAttempted.current) return;
    const initAuth = async () => {
      try {
        initializationAttempted.current = true;
        setIsLoading(true);
        const status = await checkServerHealth();
        if (status === 'healthy') await checkAuth();
      } finally {
        setIsLoading(false);
        setIsInitialized(true);
      }
    };
    initAuth();
  }, []);

  // 'owner' replaces the old 'super_admin': platform staff are a separate realm
  // in LeadBee and never appear as a tenant user, so the top tenant role is the
  // organization's owner.
  const ADMIN_ROLES = ['owner', 'admin'];

  const hasPermission = useCallback(
    (permission: string) => {
      if (!user) return false;
      if (ADMIN_ROLES.includes(user.role)) return true;
      const perms = getEffectivePermissions(user);
      return perms.includes('*') || perms.includes(permission);
    },
    [user]
  );

  const hasAnyPermission = useCallback(
    (permissions: string[]) => {
      if (!user) return false;
      if (ADMIN_ROLES.includes(user.role)) return true;
      const perms = getEffectivePermissions(user);
      if (perms.includes('*')) return true;
      return permissions.some((p) => perms.includes(p));
    },
    [user]
  );

  const safeUser = user ? { ...user, permissions: getEffectivePermissions(user) } : null;

  // Mirrors the server's organizer test: role string first, then the
  // users.manage grant. That fallback handles a custom role where user.role
  // stays 'user' but full visibility has been granted directly.
  const isOrganizer: boolean = safeUser
    ? ['owner', 'admin', 'manager'].includes(safeUser.role) ||
      safeUser.permissions.includes('*') ||
      safeUser.permissions.includes('users.manage')
    : false;

  const switchViewMode = useCallback(() => {
    setViewMode(prev => {
      const next: ViewMode = prev === 'admin' ? 'agent' : 'admin';
      AsyncStorage.setItem(VIEW_MODE_KEY, next);
      return next;
    });
  }, []);

  const value: AuthContextType = {
    user: safeUser,
    organization,
    account,
    isAccountSession: !safeUser && !!account,
    orgInactiveMessage,
    clearOrgInactive,
    isAuthenticated: !!safeUser,
    isLoading,
    isInitialized,
    serverStatus,
    isCheckingServer,
    isOrganizer,
    viewMode: isOrganizer ? viewMode : 'agent',
    switchViewMode,
    login,
    logout,
    checkAuth,
    refreshAuth,
    reloadSession,
    reloadAccount,
    createOrganization,
    switchOrganization,
    organizationTransition,
    checkServerHealth,
    retryServerConnection,
    hasPermission,
    hasAnyPermission,
  };

  return React.createElement(AuthContext.Provider, { value }, children);
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
