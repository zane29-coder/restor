import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  BranchMenu,
  BranchSummary,
  CustomerProfile,
  MenuProduct,
  StorefrontInfo,
} from '@restor/shared-types';
import { api, onSessionLost, tenantSlug } from '../api';
import { errorMessage } from '../lib/errors';
import { load, save } from '../lib/storage';
import { getWebApp, isInsideTelegram, onActivated, paintChrome } from '../telegram';

/** A menu product with where it sits in the menu. */
export interface IndexedProduct {
  product: MenuProduct;
  categoryId: string;
  categoryName: string;
}

interface Session {
  info: StorefrontInfo;
  branches: BranchSummary[];
  branch: BranchSummary | null;
  selectBranch: (branchId: string) => void;

  menu: BranchMenu | null;
  menuError: string | null;
  reloadMenu: () => void;
  products: Map<string, IndexedProduct>;

  profile: CustomerProfile;
  setProfile: (profile: CustomerProfile) => void;

  /** Favourites of THIS restaurant, for the hearts on its menu. */
  favoriteIds: Set<string>;
  toggleFavorite: (productId: string) => Promise<void>;

  unread: number;
  refreshUnread: () => void;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession outside SessionProvider');
  return session;
}

type Boot =
  | { state: 'loading' }
  | { state: 'error'; message: string; canRetry: boolean }
  | {
      state: 'ready';
      info: StorefrontInfo;
      branches: BranchSummary[];
      profile: CustomerProfile;
      favorites: string[];
    };

/**
 * Signs in and loads what every screen needs, once.
 *
 * Sign-in is the whole Telegram integration: `initData` goes to the backend,
 * which verifies its HMAC before it creates or finds the customer. Nothing
 * here decides who the user is. When a session can no longer be refreshed,
 * the same `initData` signs in again quietly.
 */
export function SessionProvider({
  children,
  splash,
  failure,
}: {
  children: ReactNode;
  splash: ReactNode;
  failure: (message: string, retry: (() => void) | null) => ReactNode;
}) {
  const [boot, setBoot] = useState<Boot>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const webApp = getWebApp();
    if (!isInsideTelegram() || !webApp) {
      setBoot({
        state: 'error',
        message: 'Bu sahifa Telegram ilovasi ichida ochilishi kerak',
        canRetry: false,
      });
      return;
    }

    let cancelled = false;
    const signIn = () => api.auth.loginWithTelegram({ initData: webApp.initData, tenantSlug });

    onSessionLost(() => {
      void signIn().catch(() => undefined);
    });

    setBoot({ state: 'loading' });
    void (async () => {
      try {
        await signIn();
        const [info, branches, profile, favorites] = await Promise.all([
          api.storefront.info(),
          api.branches.summaries(),
          api.me.profile(),
          api.me.favorites().catch(() => []),
        ]);
        if (cancelled) return;
        applyBrandColor(info.restaurant.primaryColor);
        setBoot({
          state: 'ready',
          info,
          branches,
          profile,
          favorites: favorites.filter((f) => f.isCurrentRestaurant).map((f) => f.productId),
        });
      } catch (error) {
        if (cancelled) return;
        setBoot({ state: 'error', message: errorMessage(error), canRetry: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (boot.state === 'loading') return <>{splash}</>;
  if (boot.state === 'error') {
    return <>{failure(boot.message, boot.canRetry ? () => setAttempt((n) => n + 1) : null)}</>;
  }

  return (
    <ReadySession
      info={boot.info}
      branches={boot.branches}
      initialProfile={boot.profile}
      initialFavorites={boot.favorites}
    >
      {children}
    </ReadySession>
  );
}

function ReadySession({
  info,
  branches,
  initialProfile,
  initialFavorites,
  children,
}: {
  info: StorefrontInfo;
  branches: BranchSummary[];
  initialProfile: CustomerProfile;
  initialFavorites: string[];
  children: ReactNode;
}) {
  const [branchId, setBranchId] = useState<string | null>(() => {
    const saved = load<string | null>('branch', null);
    return branches.some((b) => b.id === saved) ? saved : (branches[0]?.id ?? null);
  });
  const branch = branches.find((b) => b.id === branchId) ?? null;

  const [menu, setMenu] = useState<BranchMenu | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [menuVersion, setMenuVersion] = useState(0);

  const [profile, setProfile] = useState(initialProfile);
  const [favoriteIds, setFavoriteIds] = useState(() => new Set(initialFavorites));
  const [unread, setUnread] = useState(0);

  const selectBranch = useCallback((id: string) => {
    save('branch', id);
    setBranchId(id);
  }, []);

  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    setMenuError(null);
    api.catalog
      .branchMenu(branchId)
      .then((loaded) => !cancelled && setMenu(loaded))
      .catch((error) => !cancelled && setMenuError(errorMessage(error, 'Menyu yuklanmadi')));
    return () => {
      cancelled = true;
    };
  }, [branchId, menuVersion]);

  const reloadMenu = useCallback(() => setMenuVersion((n) => n + 1), []);

  const refreshUnread = useCallback(() => {
    api.me
      .unreadCount()
      .then((result) => setUnread(result.count))
      .catch(() => undefined);
  }, []);

  // Fresh counts and a fresh menu when the customer comes back to the app —
  // a dish may have sold out while the sheet was minimised.
  const lastRefresh = useRef(Date.now());
  useEffect(() => {
    refreshUnread();
    return onActivated(() => {
      refreshUnread();
      if (Date.now() - lastRefresh.current > 2 * 60_000) {
        lastRefresh.current = Date.now();
        reloadMenu();
      }
    });
  }, [refreshUnread, reloadMenu]);

  const favoritesRef = useRef(favoriteIds);
  favoritesRef.current = favoriteIds;

  const toggleFavorite = useCallback(async (productId: string) => {
    const wasFavorite = favoritesRef.current.has(productId);
    setFavoriteIds((current) => {
      const next = new Set(current);
      if (wasFavorite) next.delete(productId);
      else next.add(productId);
      return next;
    });
    try {
      if (wasFavorite) await api.me.removeFavorite(productId);
      else await api.me.addFavorite(productId);
    } catch (error) {
      // Put the heart back the way the server still has it.
      setFavoriteIds((current) => {
        const next = new Set(current);
        if (wasFavorite) next.add(productId);
        else next.delete(productId);
        return next;
      });
      throw error;
    }
  }, []);

  const products = useMemo(() => {
    const index = new Map<string, IndexedProduct>();
    for (const category of menu?.categories ?? []) {
      for (const product of category.products) {
        if (!index.has(product.id)) {
          index.set(product.id, { product, categoryId: category.id, categoryName: category.name });
        }
      }
    }
    return index;
  }, [menu]);

  const value = useMemo<Session>(
    () => ({
      info,
      branches,
      branch,
      selectBranch,
      menu,
      menuError,
      reloadMenu,
      products,
      profile,
      setProfile,
      favoriteIds,
      toggleFavorite,
      unread,
      refreshUnread,
    }),
    [
      info,
      branches,
      branch,
      selectBranch,
      menu,
      menuError,
      reloadMenu,
      products,
      profile,
      favoriteIds,
      toggleFavorite,
      unread,
      refreshUnread,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** The restaurant's white-label colour, applied once it is known. */
function applyBrandColor(color: string | null | undefined): void {
  if (!color || !/^#[0-9a-f]{3,8}$/i.test(color)) return;
  document.documentElement.style.setProperty('--primary', color);
  paintChrome();
}
