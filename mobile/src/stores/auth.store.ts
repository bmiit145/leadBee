import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { User } from '../types';
import { authService } from '../services/auth.service';
import { projectService } from '../services/project.service';
import { storage } from '../utils/storage';
import { systemService, ServerStatus } from '../services/system.service';
import { setForcedLogoutCallback, setOrgInactiveCallback } from '../services/api';
import { ProjectRef, Organization } from '../types';

export type ViewMode = 'admin' | 'agent';
const VIEW_MODE_KEY = 'lead_view_mode';

const getEffectivePermissions = (user: User | null): string[] => {
  if (!user) return [];
  const directPermissions = Array.isArray(user.permissions) ? user.permissions : [];
  const rolePermissions = Array.isArray(user.roleId?.permissions) ? user.roleId.permissions : [];
  return Array.from(new Set([...directPermissions, ...rolePermissions]));
};

interface AuthContextType {
  user: User | null;
  /** The tenant this session belongs to. Null before sign-in. */
  organization: Organization | null;
  /** Set when the API reports the tenant is suspended or its trial lapsed.
   *  Distinct from a sign-in failure — the credentials are fine. */
  orgInactiveMessage: string | null;
  clearOrgInactive: () => void;
  projects: ProjectRef[];
  defaultProject: ProjectRef | null;
  isProjectsLoading: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  serverStatus: ServerStatus;
  isCheckingServer: boolean;
  isOrganizer: boolean;
  viewMode: ViewMode;
  switchViewMode: () => void;
  login: (phone: string, password: string, organizationId?: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  refreshProjects: (options?: { force?: boolean }) => Promise<void>;
  checkServerHealth: () => Promise<ServerStatus>;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [orgInactiveMessage, setOrgInactiveMessage] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [defaultProject, setDefaultProject] = useState<ProjectRef | null>(null);
  const [isProjectsLoading, setIsProjectsLoading] = useState(false);
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

  const extractDefaultProjectId = useCallback((currentUser: User | null): string | null => {
    if (!currentUser?.defaultProject) return null;
    if (typeof currentUser.defaultProject === 'string') return currentUser.defaultProject;
    return currentUser.defaultProject._id;
  }, []);

  const applyProjectState = useCallback(
    (data: { projects: ProjectRef[]; defaultProject: ProjectRef | null }, currentUser: User | null) => {
      const availableProjects = data.projects || [];
      const userDefaultId = extractDefaultProjectId(currentUser);
      const apiDefaultId = data.defaultProject?._id || null;
      const preferredId = userDefaultId || apiDefaultId;
      const matchedDefault = preferredId
        ? availableProjects.find((p) => p._id === preferredId) || null
        : null;
      setProjects(availableProjects);
      setDefaultProject(matchedDefault || data.defaultProject || null);
    },
    [extractDefaultProjectId]
  );

  const refreshProjectsForUser = useCallback(
    async (currentUser: User | null, options?: { force?: boolean }) => {
      if (!currentUser) { setProjects([]); setDefaultProject(null); return; }
      setIsProjectsLoading(true);
      try {
        const data = await projectService.preloadProjects({ force: options?.force === true });
        applyProjectState(data, currentUser);
      } catch {
        console.warn('⚠️ Failed to refresh projects');
      } finally {
        setIsProjectsLoading(false);
      }
    },
    [applyProjectState]
  );

  const refreshProjects = useCallback(
    async (options?: { force?: boolean }) => { await refreshProjectsForUser(user, options); },
    [refreshProjectsForUser, user]
  );

  const checkAuth = useCallback(async () => {
    try {
      const [token, cachedUser] = await Promise.all([storage.getAccessToken(), storage.getUser()]);
      if (!token) { setUser(null); return; }

      if (cachedUser) {
        setUser(cachedUser);
        const cachedProjects = await projectService.getCachedProjects();
        if (cachedProjects) applyProjectState(cachedProjects, cachedUser);
      }

      try {
        const session = await authService.getMe();
        setUser(session.user);
        setOrganization(session.organization);
        await storage.setUser(session.user);
        void refreshProjectsForUser(session.user, { force: false });
      } catch (error: any) {
        const status = error.response?.status;
        if (status === 401 || status === 403 || status === 400) {
          try {
            await authService.refresh();
            const session = await authService.getMe();
            setUser(session.user);
            setOrganization(session.organization);
            await storage.setUser(session.user);
            void refreshProjectsForUser(session.user, { force: false });
          } catch (refreshError: any) {
            const refreshStatus = refreshError?.response?.status;
            if (refreshStatus === 400 || refreshStatus === 401 || refreshStatus === 403) {
              setUser(null); setOrganization(null); setProjects([]); setDefaultProject(null);
              await projectService.clearCache();
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
  }, [applyProjectState, refreshProjectsForUser]);

  const refreshAuth = useCallback(async () => {
    try {
      setIsLoading(true);
      await authService.refresh();
      const session = await authService.getMe();
      setUser(session.user);
      setOrganization(session.organization);
      void refreshProjectsForUser(session.user, { force: true });
    } catch {
      setUser(null); setOrganization(null); setProjects([]); setDefaultProject(null);
      await projectService.clearCache();
      await storage.clearTokens();
    } finally {
      setIsLoading(false);
    }
  }, [refreshProjectsForUser]);

  const login = useCallback(
    async (phone: string, password: string, organizationId?: string) => {
      try {
        setIsLoading(true);
        setOrgInactiveMessage(null);
        const result = await authService.login(phone, password, organizationId);
        setUser(result.user);
        setOrganization(result.organization);
        await storage.setUser(result.user);
        void refreshProjectsForUser(result.user, { force: true });
      } catch (error) {
        setUser(null); setOrganization(null); setProjects([]); setDefaultProject(null);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [refreshProjectsForUser]
  );

  const logout = useCallback(async () => {
    try {
      setIsLoading(true);
      await authService.logout();
    } catch {
      // Ignored: the local session is cleared regardless.
    } finally {
      setUser(null); setOrganization(null); setProjects([]); setDefaultProject(null);
      setOrgInactiveMessage(null);
      await projectService.clearCache();
      await storage.clearTokens();
      setIsLoading(false);
    }
  }, []);

  const clearOrgInactive = useCallback(() => setOrgInactiveMessage(null), []);

  // Bridge the Axios interceptors into React state.
  useEffect(() => {
    setForcedLogoutCallback(async () => {
      setUser(null); setOrganization(null); setProjects([]); setDefaultProject(null);
      await projectService.clearCache();
      await storage.clearTokens();
    });

    // A suspended tenant is not an auth failure: the credentials are valid and
    // the account is fine. Clearing tokens would drop the user at a login
    // screen that rejects them with the same message and no explanation, so the
    // session is kept and a dedicated screen explains what happened.
    setOrgInactiveCallback((message: string) => {
      setOrgInactiveMessage(message);
    });
  }, []);

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
    orgInactiveMessage,
    clearOrgInactive,
    projects,
    defaultProject,
    isProjectsLoading,
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
    refreshProjects,
    checkServerHealth,
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
