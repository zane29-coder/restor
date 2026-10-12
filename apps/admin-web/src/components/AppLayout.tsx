import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Permission } from '@restor/shared-types';
import {
  IconBars,
  IconBranch,
  IconClock,
  IconLogout,
  IconMoon,
  IconPlus,
  IconSearch,
  IconSun,
} from '@restor/ui';
import { useAuth } from '../lib/auth';
import { BranchProvider, todaysHours, useBranch } from '../lib/branch';
import { initialsOf, timeOf } from '../lib/format';
import { ROLE_LABELS } from '../lib/labels';
import {
  useCouriersOnDelivery,
  useNewOrders,
  usePendingWaiterCalls,
  useStockSummary,
} from '../lib/live';
import { useTheme } from '../lib/theme';
import { BranchSwitcher } from './BranchSwitcher';
import { CommandPalette } from './CommandPalette';
import { Logo } from './Logo';
import { NAV_GROUPS, type NavBadgeKey } from './nav';
import { NotificationsBell } from './NotificationsBell';

/**
 * The till lives on its own host (`pos.restor.uz` next to `app.restor.uz`),
 * so "new order" opens it rather than duplicating a cart here. `VITE_POS_URL`
 * overrides the guess, e.g. for local development.
 */
function posUrl(): string | null {
  const configured = import.meta.env.VITE_POS_URL as string | undefined;
  if (configured) return configured;
  const { protocol, host } = window.location;
  if (host.startsWith('app.')) return `${protocol}//pos.${host.slice(4)}`;
  if (host.startsWith('localhost')) return `${protocol}//localhost:5175`;
  return null;
}

export function AppLayout() {
  return (
    <BranchProvider>
      <Shell />
    </BranchProvider>
  );
}

function Shell() {
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // The off-canvas nav closes on navigation, like any mobile menu.
  useEffect(() => setNavOpen(false), [location.pathname]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const closePalette = useCallback(() => setPaletteOpen(false), []);

  return (
    <div className={`app${navOpen ? ' app--nav-open' : ''}`}>
      <Sidebar />
      {navOpen && <div className="app-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />}

      <div className="app-body">
        <TopBar onMenu={() => setNavOpen(true)} onSearch={() => setPaletteOpen(true)} />
        <main className="app-content">
          <Outlet />
        </main>
      </div>

      {paletteOpen && <CommandPalette onClose={closePalette} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                            */
/* ------------------------------------------------------------------ */

function Sidebar() {
  const { user, logout, can } = useAuth();
  const { branches } = useBranch();
  const badges = useNavBadges();
  const newOrders = useNewOrders();

  const role = user?.roles[0];

  return (
    <aside className="app-side" aria-label="Asosiy menyu">
      <div className="app-side__top">
        <Logo height={26} className="app-side__logo" />

        <div className="app-side__tenant">
          <span className="app-side__tenant-icon">
            <IconBranch size={17} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="app-side__tenant-name">{user?.tenantName ?? user?.tenantSlug}</div>
            <div className="app-side__tenant-sub">
              {branches.length > 0 ? `${branches.length} ta filial` : 'Restoran'}
            </div>
          </div>
        </div>
      </div>

      <nav className="app-side__nav">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => !item.permission || can(item.permission));
          if (items.length === 0) return null;
          return (
            <div key={group.label} className="app-side__group">
              <div className="app-side__group-label">{group.label}</div>
              {items.map(({ to, label, Icon, badge }) => {
                const b = badge ? badges[badge] : undefined;
                return (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    className={({ isActive }) =>
                      `app-nav-link${isActive ? ' app-nav-link--active' : ''}`
                    }
                  >
                    <Icon size={19} />
                    <span className="app-nav-link__label">{label}</span>
                    {b && (
                      <span className={`app-nav-badge${b.tone ? ` app-nav-badge--${b.tone}` : ''}`}>
                        {b.text}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="app-side__foot">
        {can(Permission.ORDERS_VIEW) && (
          <div className="app-side__status" role="status">
            <span
              className={`status-dot ${
                newOrders.isError ? 'status-dot--off' : 'status-dot--live'
              }`}
            />
            {newOrders.isError
              ? 'Server bilan aloqa yoʻq'
              : newOrders.dataUpdatedAt
                ? `Jonli yangilanish · ${timeOf(new Date(newOrders.dataUpdatedAt))}`
                : 'Ulanmoqda…'}
          </div>
        )}

        <div className="app-side__user">
          {user?.avatarUrl ? (
            <img className="avatar" src={user.avatarUrl} alt="" />
          ) : (
            <span className="avatar">{initialsOf(user?.fullName)}</span>
          )}
          <div style={{ minWidth: 0 }}>
            <div className="app-side__user-name">{user?.fullName}</div>
            <div className="app-side__user-role">
              {role ? (ROLE_LABELS[role] ?? role) : 'Xodim'}
            </div>
          </div>
          <button
            type="button"
            className="app-side__logout"
            title="Chiqish"
            aria-label="Chiqish"
            onClick={() => void logout()}
          >
            <IconLogout size={18} />
          </button>
        </div>
      </div>
    </aside>
  );
}

type Badge = { text: string; tone?: 'info' | 'danger' };

/** Counts on the nav items; absent (not zero) when there is nothing to do. */
function useNavBadges(): Partial<Record<NavBadgeKey, Badge>> {
  const orders = useNewOrders();
  const couriers = useCouriersOnDelivery();
  const stock = useStockSummary();
  const calls = usePendingWaiterCalls();

  const result: Partial<Record<NavBadgeKey, Badge>> = {};
  const newCount = orders.data?.pagination.total ?? 0;
  if (newCount > 0) result.orders = { text: `${newCount} yangi` };
  const onDelivery = couriers.data?.pagination.total ?? 0;
  if (onDelivery > 0) result.couriers = { text: `${onDelivery} yoʻlda`, tone: 'info' };
  const low = stock.data?.lowCount ?? 0;
  if (low > 0) result.inventory = { text: `${low} kam`, tone: 'danger' };
  const callCount = calls.data?.length ?? 0;
  if (callCount > 0) result.tables = { text: `${callCount} chaqiruv`, tone: 'danger' };
  return result;
}

/* ------------------------------------------------------------------ */
/* Top bar                                                            */
/* ------------------------------------------------------------------ */

function TopBar({ onMenu, onSearch }: { onMenu: () => void; onSearch: () => void }) {
  const { user, can } = useAuth();
  const { current } = useBranch();
  const { theme, toggle } = useTheme();
  const hours = current ? todaysHours(current) : null;
  const pos = posUrl();
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <header className="app-top">
      <button
        type="button"
        className="icon-btn app-top__menu-btn"
        aria-label="Menyuni ochish"
        onClick={onMenu}
      >
        <IconBars size={20} />
      </button>

      <div className="app-top__group">
        <BranchSwitcher />
        {current && (
          <span className="app-top__hours">
            <IconClock size={15} />
            {hours ? `Ish vaqti: ${hours}` : 'Bugun dam olish kuni'}
          </span>
        )}
      </div>

      <div className="app-top__spacer" />

      <button type="button" className="top-search" onClick={onSearch} aria-label="Qidiruv">
        <IconSearch size={17} />
        <span className="top-search__text">Buyurtma, mijoz yoki taom qidirish…</span>
        <span className="kbd">{isMac ? '⌘K' : 'Ctrl+K'}</span>
      </button>

      {pos && can(Permission.POS_ACCESS) && (
        <a className="btn" href={pos} target="_blank" rel="noreferrer" style={{ minHeight: 36 }}>
          <IconPlus size={17} />
          <span className="app-top__new-label">Yangi buyurtma</span>
        </a>
      )}

      <NotificationsBell />

      <button
        type="button"
        className="icon-btn"
        title={theme === 'dark' ? 'Yorugʻ rejim' : 'Qorongʻi rejim'}
        aria-label={theme === 'dark' ? 'Yorugʻ rejimga oʻtish' : 'Qorongʻi rejimga oʻtish'}
        onClick={toggle}
      >
        {theme === 'dark' ? <IconSun size={19} /> : <IconMoon size={19} />}
      </button>

      {user?.avatarUrl ? (
        <img className="avatar avatar--ring" src={user.avatarUrl} alt="" />
      ) : (
        <span className="avatar avatar--ring" title={user?.fullName}>
          {initialsOf(user?.fullName)}
        </span>
      )}
    </header>
  );
}
