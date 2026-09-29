import type { ComponentType } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Permission } from '@restor/shared-types';
import {
  IconBranch,
  IconDashboard,
  IconLogout,
  IconMenu,
  IconOrders,
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
];

const TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/orders': 'Buyurtmalar',
  '/menu': 'Menyu',
  '/branches': 'Filiallar',
  '/employees': 'Xodimlar',
};

export function AppLayout() {
  const { user, logout, can } = useAuth();
  const location = useLocation();

  const visible = NAV.filter((item) => !item.permission || can(item.permission));

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar__brand">
          RES<span>TOR</span>
        </div>

        <nav>
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
          <div>{user?.fullName}</div>
          <div>{user?.roles.join(', ')}</div>
        </div>
      </aside>

      <div className="main">
        <header className="header">
          <h1 className="header__title">{TITLES[location.pathname] ?? 'RESTOR'}</h1>
          <div className="row">
            <span className="muted">{user?.tenantSlug ?? 'platform'}</span>
            <button type="button" className="btn btn--ghost" onClick={() => void logout()}>
              <IconLogout size={16} />
              Chiqish
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
