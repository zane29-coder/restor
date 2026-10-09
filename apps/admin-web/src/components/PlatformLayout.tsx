import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { IconBranch, IconDashboard, IconLogout, IconTag } from '@restor/ui';
import { useAuth } from '../lib/auth';

/**
 * Shell for the super admin (TZ §6).
 *
 * Deliberately separate from `AppLayout`: a platform administrator sells and
 * suspends restaurants, and does not run a kitchen. Giving them the tenant
 * navigation was worse than clutter — their token carries no tenant, so every
 * one of those screens either failed or, because tenant scoping is bypassed
 * for them, mixed figures from every restaurant into one meaningless total.
 */
const NAV = [
  { to: '/', label: 'Platforma', Icon: IconDashboard },
  { to: '/tenants', label: 'Korxonalar', Icon: IconBranch },
  { to: '/plans', label: 'Planlar', Icon: IconTag },
];

const TITLES: Record<string, string> = {
  '/': 'Platforma holati',
  '/tenants': 'Korxonalar',
  '/plans': 'Tariflar',
};

export function PlatformLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="layout">
      <aside className="sidebar sidebar--platform">
        <div className="sidebar__brand">
          RES<span>TOR</span>
          <div className="sidebar__badge">Platforma</div>
        </div>

        <nav className="sidebar__nav" aria-label="Platforma menyusi">
          {NAV.map(({ to, label, Icon }) => (
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
          <div>Super admin</div>
        </div>
      </aside>

      <div className="main">
        <header className="header">
          <h1 className="header__title">{TITLES[location.pathname] ?? 'Platforma'}</h1>
          <div className="header__actions">
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
