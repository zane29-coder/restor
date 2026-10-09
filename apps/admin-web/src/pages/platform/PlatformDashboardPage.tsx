import { useQuery } from '@tanstack/react-query';
import { formatMoney } from '@restor/shared-utils';
import { api } from '../../lib/api';
import { ErrorState, Loading } from '../../components/States';

/**
 * Platform-wide figures (TZ §6).
 *
 * The super admin's equivalent of the company dashboard: how many restaurants
 * are on the platform, how many are paying, and what is flowing through it.
 */
export function PlatformDashboardPage() {
  const stats = useQuery({
    queryKey: ['platform', 'stats'],
    queryFn: () => api.platform.stats(),
    refetchInterval: 60_000,
  });

  if (stats.isLoading) return <Loading />;
  if (stats.isError) {
    return <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />;
  }

  const data = stats.data;
  if (!data) return null;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section>
        <h2 className="section-title">Korxonalar</h2>
        <div className="stat-grid">
          <Stat label="Jami" value={String(data.totalCompanies)} />
          <Stat
            label="Faol"
            value={String(data.activeCompanies)}
            hint={`${data.totalBranches} filial`}
          />
          <Stat label="Bloklangan" value={String(data.blockedCompanies)} />
        </div>
      </section>

      <section>
        <h2 className="section-title">Obunalar</h2>
        <div className="stat-grid">
          <Stat label="Faol obuna" value={String(data.activeSubscriptions)} />
          <Stat label="Muddati tugagan" value={String(data.expiredSubscriptions)} />
          <Stat
            label="Oylik tushum"
            value={formatMoney(data.monthlyRevenue)}
            hint="obunalardan"
          />
        </div>
      </section>

      <section>
        <h2 className="section-title">Platforma aylanmasi</h2>
        <div className="stat-grid">
          <Stat label="Buyurtmalar" value={String(data.totalOrders)} hint="barcha korxonalar" />
          <Stat label="GMV" value={formatMoney(data.gmv)} hint="barcha korxonalar" />
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <p className="stat__label">{label}</p>
      <p className="stat__value">{value}</p>
      {hint && <p className="stat__hint">{hint}</p>}
    </div>
  );
}
