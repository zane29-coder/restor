import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { setUnauthorizedHandler } from './lib/api';
import { useAuth } from './lib/auth';
import { AppLayout } from './components/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { OrdersPage } from './pages/OrdersPage';
import { MenuPage } from './pages/MenuPage';
import { BranchesPage } from './pages/BranchesPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { CouriersPage } from './pages/CouriersPage';
import { CustomersPage } from './pages/CustomersPage';
import { MarketingPage } from './pages/MarketingPage';
import { ReportsPage } from './pages/ReportsPage';
import { InventoryPage } from './pages/InventoryPage';
import { TablesPage } from './pages/TablesPage';
import { TelegramPage } from './pages/TelegramPage';
import { PlatformLayout } from './components/PlatformLayout';
import { PlatformDashboardPage } from './pages/platform/PlatformDashboardPage';
import { TenantsPage } from './pages/platform/TenantsPage';
import { PlansPage } from './pages/platform/PlansPage';

export function App() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  // Replace the client's default hard reload with a soft navigation, so an
  // expired session does not throw away the page the user was on.
  useEffect(() => {
    setUnauthorizedHandler(() => navigate('/login', { replace: true }));
  }, [navigate]);

  if (isLoading) {
    return (
      <div className="center">
        <div className="spinner" aria-label="Yuklanmoqda" />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  /*
   * Two entirely separate route trees (TZ §6).
   *
   * The super admin sells and suspends restaurants; they do not run one. Their
   * token carries no tenant, so the company screens below could not work for
   * them anyway — and because tenant scoping is bypassed for the platform role,
   * a shared dashboard silently summed every restaurant into one figure.
   */
  if (user.isSuperAdmin) {
    return (
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route element={<PlatformLayout />}>
          <Route index element={<PlatformDashboardPage />} />
          <Route path="tenants" element={<TenantsPage />} />
          <Route path="plans" element={<PlansPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="menu" element={<MenuPage />} />
        <Route path="branches" element={<BranchesPage />} />
        <Route path="employees" element={<EmployeesPage />} />
        <Route path="couriers" element={<CouriersPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="marketing" element={<MarketingPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="tables" element={<TablesPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="telegram" element={<TelegramPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
