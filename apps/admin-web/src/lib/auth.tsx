import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthenticatedUser, Permission } from '@restor/shared-types';
import { api } from './api';

interface AuthState {
  user: AuthenticatedUser | null;
  isLoading: boolean;
  login: (login: string, password: string, tenantSlug?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Permission check — the SAME codes the backend enforces (TZ §5). */
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore the session on boot: a stored refresh token survives a reload.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        if (await api.http.isAuthenticated()) {
          const me = await api.auth.me();
          if (!cancelled) setUser(me);
        }
      } catch {
        // Token expired or revoked — fall through to the login screen.
        await api.http.clearTokens();
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (loginValue: string, password: string, tenantSlug?: string) => {
    const session = await api.auth.login({ login: loginValue, password, tenantSlug });
    setUser(session.user);
  }, []);

  const logout = useCallback(async () => {
    await api.auth.logout();
    setUser(null);
  }, []);

  const can = useCallback(
    (permission: Permission) => {
      if (!user) return false;
      // Mirrors the backend's guard: super admin short-circuits.
      if (user.isSuperAdmin) return true;
      return user.permissions.includes(permission);
    },
    [user],
  );

  const value = useMemo<AuthState>(
    () => ({ user, isLoading, login, logout, can }),
    [user, isLoading, login, logout, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/**
 * Hides UI the user cannot act on.
 *
 * Presentation only — the backend enforces the same permission on every call,
 * so a hidden button is a courtesy, never a control (TZ §52).
 */
export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can } = useAuth();
  return <>{can(permission) ? children : fallback}</>;
}
