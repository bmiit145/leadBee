import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { platformService } from '@/services/platform.service';
import { tokenStore } from '@/services/api';
import type { PlatformAdmin } from '@/types';

interface AuthState {
  admin: PlatformAdmin | null;
  permissions: string[];
  /** True until the initial session probe settles — routes must not redirect
   *  during this window or a refresh bounces the user to /login. */
  loading: boolean;
  login: (email: string, password: string, totp?: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<PlatformAdmin | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSession = useCallback(async () => {
    if (!tokenStore.access) {
      setAdmin(null);
      setPermissions([]);
      setLoading(false);
      return;
    }
    try {
      const session = await platformService.me();
      setAdmin(session.admin);
      setPermissions(session.permissions);
    } catch {
      // The api interceptor has already tried a refresh and cleared the tokens
      // if it failed; there is nothing left to recover here.
      tokenStore.clear();
      setAdmin(null);
      setPermissions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const login = useCallback(async (email: string, password: string, totp?: string) => {
    const result = await platformService.login(email, password, totp);
    tokenStore.set(result.accessToken, result.refreshToken);
    setAdmin(result.admin);
    // /auth/me is the authority on the permission set — the login response
    // carries the admin but not the resolved grants.
    const session = await platformService.me();
    setPermissions(session.permissions);
  }, []);

  const logout = useCallback(async () => {
    try {
      await platformService.logout(tokenStore.refresh ?? undefined);
    } catch {
      // A failed logout call must not strand the user in a signed-in shell.
    } finally {
      tokenStore.clear();
      setAdmin(null);
      setPermissions([]);
    }
  }, []);

  const can = useCallback(
    (permission: string) =>
      permissions.includes('*') || permissions.includes(permission),
    [permissions]
  );

  const value = useMemo<AuthState>(
    () => ({ admin, permissions, loading, login, logout, can, refresh: loadSession }),
    [admin, permissions, loading, login, logout, can, loadSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
