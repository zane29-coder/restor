import { useEffect, useRef, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Permission } from '@restor/shared-types';
import {
  IconBranch,
  IconCourier,
  IconDashboard,
  IconInbox,
  IconInfo,
  IconLogout,
  IconKitchen,
  IconMenu,
  IconOrders,
  IconPos,
  IconTag,
  IconTelegram,
  IconUsers,
  type IconProps,
} from '@restor/ui';
import { useAuth } from '../lib/auth';

interface NavItem {
  to: string;
  label: string;
  Icon: ComponentType<IconProps>;
  /** Hidden unless the user holds this permission (TZ §5). */
  permission?: Permission;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', Icon: IconDashboard },
  { to: '/orders', label: 'Buyurtmalar', Icon: IconOrders, permission: Permission.ORDERS_VIEW },
  { to: '/menu', label: 'Menyu', Icon: IconMenu, permission: Permission.PRODUCTS_VIEW },
  { to: '/branches', label: 'Filiallar', Icon: IconBranch, permission: Permission.BRANCHES_VIEW },
  { to: '/employees', label: 'Xodimlar', Icon: IconUsers, permission: Permission.EMPLOYEES_VIEW },
  { to: '/couriers', label: 'Kuryerlar', Icon: IconCourier, permission: Permission.COURIERS_VIEW },
  {
    to: '/customers',
    label: 'Mijozlar',
    Icon: IconInbox,
    permission: Permission.CUSTOMERS_VIEW,
  },
  {
    to: '/marketing',
    label: 'Aksiyalar',
    Icon: IconTag,
    permission: Permission.PROMOTIONS_VIEW,
  },
  { to: '/tables', label: 'Stollar', Icon: IconKitchen, permission: Permission.TABLES_VIEW },
  { to: '/inventory', label: 'Ombor', Icon: IconInfo, permission: Permission.INVENTORY_VIEW },
  { to: '/reports', label: 'Hisobotlar', Icon: IconPos, permission: Permission.REPORTS_VIEW },
  { to: '/telegram', label: 'Telegram', Icon: IconTelegram, permission: Permission.TELEGRAM_VIEW },
];

const TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/orders': 'Buyurtmalar',
  '/menu': 'Menyu',
  '/branches': 'Filiallar',
  '/employees': 'Xodimlar',
  '/couriers': 'Kuryerlar va dispetcher',
  '/customers': 'Mijozlar va sodiqlik',
  '/marketing': 'Aksiyalar va promokodlar',
  '/tables': 'Stollar va QR xizmat',
  '/inventory': 'Ombor va yetkazib beruvchilar',
  '/reports': 'Hisobotlar',
  '/telegram': 'Telegram sozlamalari',
};

export function AppLayout() {
  const { user, logout, can } = useAuth();
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);

  const visible = NAV.filter((item) => !item.permission || can(item.permission));

  // On narrow screens the nav is a horizontal strip; bring the current section
  // into view so the user can see where they are.
  useEffect(() => {
    navRef.current
      ?.querySelector('.nav-link--active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [location.pathname]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar__brand">
          RES<span>TOR</span>
        </div>

        <nav ref={navRef} className="sidebar__nav" aria-label="Asosiy menyu">
          {visible.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `nav-link${isActive ? ' nav-link--active' : ''}`}
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div className="sidebar__user">{user?.fullName}</div>
          <div>{user?.roles.join(', ')}</div>
        </div>
      </aside>

      <div className="main">
        <header className="header">
          <h1 className="header__title">{TITLES[location.pathname] ?? 'RESTOR'}</h1>
          <div className="header__actions">
            <span className="header__tenant">{user?.tenantSlug ?? 'platform'}</span>
            <button
              type="button"
              className="btn btn--ghost"
              aria-label="Chiqish"
              onClick={() => void logout()}
            >
              <IconLogout size={16} />
              <span className="header__logout-label">Chiqish</span>
            </button>
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
