import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  Permission,
  type BranchReportRow,
  type DashboardStats,
  type Order,
  type Paginated,
  type RevenuePoint,
  type SalesReport,
  type StockSummary,
  type TopProductRow,
} from '@restor/shared-types';
import {
  IconAlert,
  IconArrowRight,
  IconBasket,
  IconCheckCircle,
  IconCourier,
  IconDownload,
  IconFire,
  IconOrders,
  IconPieChart,
  IconQr,
  IconTable,
  IconTrophy,
  IconUsers,
  IconWallet,
  IconChart,
} from '@restor/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useBranch } from '../lib/branch';
import {
  ago,
  compactSom,
  count,
  amount,
  percent,
  qty,
  som,
  timeOf,
} from '../lib/format';
import { ORDER_TYPE_LABELS, PAYMENT_METHOD_LABELS, STOCK_UNIT_LABELS } from '../lib/labels';
import { useStockSummary } from '../lib/live';
import { BarList, Donut, LineChart, Sparkline, type LineSeries } from '../components/charts';
import {
  Card,
  Delta,
  Kpi,
  LivePill,
  PageHeader,
  PeriodPicker,
  Seg,
  changeOf,
  downloadCsv,
  periodDays,
  periodFor,
  previousPeriod,
  type Period,
} from '../components/ui';
import { StatusBadge } from '../components/StatusBadge';
import { ErrorState, Loading } from '../components/States';
import { ACTIVE_STATUSES, itemsSummary } from '../lib/orders';

/**
 * Company dashboard (TZ §7).
 *
 * Every figure comes from the reports API, which counts DELIVERED orders net
 * of refunds — the same rule the Reports screen uses, so the two never show
 * two revenues for one day. The previous period is fetched separately for
 * the deltas the dashboard endpoint does not return itself.
 */
export function DashboardPage() {
  const { user, can } = useAuth();
  const { branchId, current, branches } = useBranch();
  const [period, setPeriod] = useState<Period>(() => periodFor('today'));
  const [metric, setMetric] = useState<'revenue' | 'orders'>('revenue');

  const canReports = can(Permission.REPORTS_VIEW);
  const prev = previousPeriod(period);
  const singleDay = period.dateFrom === period.dateTo;
  const scope = { branchId: branchId || undefined };

  const stats = useQuery({
    queryKey: ['reports', 'dashboard', period, branchId],
    queryFn: () => api.reports.dashboard({ ...scope, dateFrom: period.dateFrom, dateTo: period.dateTo }),
    enabled: canReports,
    refetchInterval: 60_000,
  });
  const prevStats = useQuery({
    queryKey: ['reports', 'dashboard', prev, branchId],
    queryFn: () => api.reports.dashboard({ ...scope, dateFrom: prev.dateFrom, dateTo: prev.dateTo }),
    enabled: canReports,
  });
  const granularity = singleDay ? 'hour' : 'day';
  const sales = useQuery({
    queryKey: ['reports', 'sales', period, branchId, granularity],
    queryFn: () =>
      api.reports.sales({ ...scope, dateFrom: period.dateFrom, dateTo: period.dateTo, granularity }),
    enabled: canReports,
    refetchInterval: 60_000,
  });
  const prevSales = useQuery({
    queryKey: ['reports', 'sales', prev, branchId, granularity],
    queryFn: () =>
      api.reports.sales({ ...scope, dateFrom: prev.dateFrom, dateTo: prev.dateTo, granularity }),
    enabled: canReports,
  });
  const products = useQuery({
    queryKey: ['reports', 'products', period, branchId, 5],
    queryFn: () =>
      api.reports.products({ ...scope, dateFrom: period.dateFrom, dateTo: period.dateTo, limit: 5 }),
    enabled: canReports,
  });
  const ranking = useQuery({
    queryKey: ['reports', 'branches', period],
    queryFn: () => api.reports.branches({ dateFrom: period.dateFrom, dateTo: period.dateTo }),
    enabled: canReports && branches.length > 1,
  });
  const active = useQuery({
    queryKey: ['orders', 'active', branchId],
    queryFn: () => api.orders.list({ ...scope, status: ACTIVE_STATUSES, limit: 6 }),
    enabled: can(Permission.ORDERS_VIEW),
    refetchInterval: 15_000,
  });
  const stock = useStockSummary();

  const firstName = user?.fullName.split(/\s+/)[0] ?? '';

  return (
    <div className="page">
      {stock.data && stock.data.lowCount > 0 && <StockAlert summary={stock.data} />}

      <PageHeader
        crumb="Boshqaruv markazi"
        title={`Xush kelibsiz, ${firstName}`}
        badge={<LivePill />}
        subtitle={`${current ? current.name : 'Barcha filiallar'} boʻyicha savdo, buyurtmalar oqimi va filiallar holati`}
        actions={
          canReports && (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={!stats.data || !sales.data}
              onClick={() =>
                stats.data &&
                sales.data &&
                exportDashboard(period, current?.name, stats.data, sales.data, products.data ?? [])
              }
            >
              <IconDownload size={17} />
              Eksport (Excel)
            </button>
          )
        }
      />

      {canReports ? (
        <>
          <div className="toolbar" style={{ justifyContent: 'space-between' }}>
            <span className="row muted" style={{ fontSize: 12, gap: 8 }}>
              <span className="status-dot status-dot--live" />
              Maʼlumotlar har daqiqada avtomatik yangilanadi
            </span>
            <PeriodPicker value={period} onChange={setPeriod} />
          </div>

          {stats.isLoading || sales.isLoading ? (
            <Loading />
          ) : stats.isError ? (
            <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
          ) : stats.data && sales.data ? (
            <>
              <KpiGrid
                stats={stats.data}
                prev={prevStats.data}
                sales={sales.data}
              />

              <div className="grid-main-side">
                <SalesCard
                  metric={metric}
                  onMetric={setMetric}
                  sales={sales.data}
                  prevSales={prevSales.data}
                  singleDay={singleDay}
                  period={period}
                  change={metric === 'revenue' ? stats.data.revenueChangePercent : stats.data.ordersChangePercent}
                />
                <SourcesCard sales={sales.data} />
              </div>
            </>
          ) : null}
        </>
      ) : (
        <div className="banner banner--info">
          Savdo koʻrsatkichlari uchun “Hisobotlarni koʻrish” huquqi kerak. Quyida faol buyurtmalar.
        </div>
      )}

      <div className="grid-main-side">
        {can(Permission.ORDERS_VIEW) && <ActiveOrdersCard query={active} />}
        {canReports && (
          <div className="stack" style={{ gap: 16 }}>
            <TopProductsCard rows={products.data ?? []} loading={products.isLoading} />
            {branches.length > 1 && (
              <BranchRankingCard
                rows={ranking.data ?? []}
                days={periodDays(period)}
                loading={ranking.isLoading}
                error={ranking.error}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function StockAlert({ summary }: { summary: StockSummary }) {
  const names = summary.lowItems
    .slice(0, 3)
    .map((item) => `${item.name} (${qty(item.quantity)} ${STOCK_UNIT_LABELS[item.unit] ?? item.unit})`)
    .join(', ');
  return (
    <div className="banner banner--danger" role="alert">
      <span className="banner__icon">
        <IconAlert size={16} />
      </span>
      <div className="banner__body">
        <div className="banner__title">
          Ombor ogohlantirishi: {summary.lowCount} ta mahsulot minimal qoldiqdan kam qoldi
        </div>
        <div className="banner__text">{names}</div>
      </div>
      <Link to="/inventory" className="btn btn--sm btn--ghost" style={{ color: 'var(--danger)' }}>
        Omborga oʻtish
        <IconArrowRight size={14} />
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* KPIs                                                               */
/* ------------------------------------------------------------------ */

function KpiGrid({
  stats,
  prev,
  sales,
}: {
  stats: DashboardStats;
  prev: DashboardStats | undefined;
  sales: SalesReport;
}) {
  const typeCount = (...types: string[]) =>
    sales.byType.filter((row) => types.includes(row.type)).reduce((sum, row) => sum + row.count, 0);
  const typeRevenue = (...types: string[]) =>
    sales.byType.filter((row) => types.includes(row.type)).reduce((sum, row) => sum + row.revenue, 0);
  const share = (n: number) => (stats.ordersCount > 0 ? (n / stats.ordersCount) * 100 : 0);

  const delivery = typeCount('DELIVERY');
  const dineIn = typeCount('DINE_IN', 'TABLE');
  const pickup = typeCount('PICKUP');
  const qrOrders = sales.bySource.find((row) => row.source === 'QR_TABLE')?.count ?? 0;
  const returning = Math.max(0, stats.customersCount - stats.newCustomersCount);
  const attempted = stats.ordersCount + stats.cancelledOrders;
  const cancelRate = attempted > 0 ? (stats.cancelledOrders / attempted) * 100 : 0;

  const revenueLine = sales.timeline.map((p) => p.revenue);
  const ordersLine = sales.timeline.map((p) => p.orders);

  return (
    <div className="kpi-grid">
      <Kpi
        label="Umumiy tushum"
        value={amount(stats.revenue)}
        unit="soʻm"
        Icon={IconWallet}
        tone="tone-primary"
        foot={
          <>
            <span className="kpi__foot-text">
              <Delta value={stats.revenueChangePercent} />
              <span>oldingi davrga</span>
            </span>
            <Sparkline values={revenueLine} color="var(--series-1)" />
          </>
        }
      />
      <Kpi
        label="Yakunlangan buyurtmalar"
        value={count(stats.ordersCount)}
        unit="ta"
        Icon={IconOrders}
        tone="tone-info"
        foot={
          <>
            <span className="kpi__foot-text">
              <Delta value={stats.ordersChangePercent} />
              <span>oʻsish</span>
            </span>
            <Sparkline values={ordersLine} color="var(--series-2)" />
          </>
        }
      />
      <Kpi
        label="Oʻrtacha chek"
        value={amount(stats.averageCheck)}
        unit="soʻm"
        Icon={IconChart}
        tone="tone-warning"
        foot={
          <span className="kpi__foot-text">
            <Delta value={changeOf(stats.averageCheck, prev?.averageCheck)} />
            <span>chek kattaligi</span>
          </span>
        }
      />
      <Kpi
        label="Mijozlar"
        value={count(stats.customersCount)}
        unit="nafar"
        Icon={IconUsers}
        tone="tone-violet"
        foot={
          <>
            <span className="kpi__foot-text">
              <span className="pill tone-neutral">
                {stats.customersCount > 0 ? percent((returning / stats.customersCount) * 100, 0) : '—'} doimiy
              </span>
            </span>
            <span>{stats.newCustomersCount} ta yangi</span>
          </>
        }
      />
      <Kpi
        label="Yetkazib berish"
        value={count(delivery)}
        unit={`ta (${percent(share(delivery), 0)})`}
        Icon={IconCourier}
        tone="tone-primary"
        foot={<span className="kpi__foot-text">Tushum: {compactSom(typeRevenue('DELIVERY'))}</span>}
      />
      <Kpi
        label="Zalda va QR stol"
        value={count(dineIn)}
        unit={`ta (${percent(share(dineIn), 0)})`}
        Icon={IconTable}
        tone="tone-info"
        foot={
          <span className="kpi__foot-text">
            <IconQr size={14} />
            {qrOrders} ta QR buyurtma
          </span>
        }
      />
      <Kpi
        label="Olib ketish"
        value={count(pickup)}
        unit={`ta (${percent(share(pickup), 0)})`}
        Icon={IconBasket}
        tone="tone-success"
        foot={<span className="kpi__foot-text">Tushum: {compactSom(typeRevenue('PICKUP'))}</span>}
      />
      <Kpi
        label="Bekor qilingan"
        value={count(stats.cancelledOrders)}
        unit="ta"
        Icon={stats.cancelledOrders === 0 ? IconCheckCircle : IconAlert}
        tone={cancelRate > 5 ? 'tone-danger' : 'tone-success'}
        foot={
          <>
            <span className="kpi__foot-text">
              <Delta value={changeOf(stats.cancelledOrders, prev?.cancelledOrders)} goodWhenDown />
            </span>
            <span>{percent(cancelRate)} buyurtmalardan</span>
          </>
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sales chart                                                        */
/* ------------------------------------------------------------------ */

function SalesCard({
  metric,
  onMetric,
  sales,
  prevSales,
  singleDay,
  period,
  change,
}: {
  metric: 'revenue' | 'orders';
  onMetric: (metric: 'revenue' | 'orders') => void;
  sales: SalesReport;
  prevSales: SalesReport | undefined;
  singleDay: boolean;
  period: Period;
  change: number | null;
}) {
  const chart = useMemo(
    () => buildChart(sales.timeline, prevSales?.timeline ?? [], metric, singleDay, period),
    [sales.timeline, prevSales?.timeline, metric, singleDay, period],
  );

  const pick = (p: RevenuePoint) => (metric === 'revenue' ? p.revenue : p.orders);
  const peak = sales.timeline.reduce<RevenuePoint | null>(
    (best, p) => (best === null || pick(p) > pick(best) ? p : best),
    null,
  );
  const fmt = (v: number) => (metric === 'revenue' ? som(v) : `${count(v)} ta`);
  const prevTotal = prevSales ? (metric === 'revenue' ? prevSales.revenue : prevSales.ordersCount) : null;
  const curTotal = metric === 'revenue' ? sales.revenue : sales.ordersCount;

  const series: LineSeries[] = [
    {
      key: 'current',
      label: singleDay ? (period.key === 'yesterday' ? 'Kecha' : 'Bugun') : 'Joriy davr',
      color: 'var(--series-1)',
      values: chart.current,
      area: true,
    },
    {
      key: 'previous',
      label: singleDay ? (period.key === 'yesterday' ? 'Oldingi kun' : 'Kecha') : 'Oldingi davr',
      color: 'var(--series-2)',
      values: chart.previous,
      dashed: true,
    },
  ];

  return (
    <Card
      title="Savdo va tushum dinamikasi"
      sub={singleDay ? 'Soatlik koʻrsatkich, oldingi kun bilan taqqoslab' : 'Kunlik koʻrsatkich, oldingi davr bilan taqqoslab'}
      actions={
        <Seg
          label="Koʻrsatkich"
          quiet
          value={metric}
          onChange={onMetric}
          options={[
            { value: 'revenue', label: 'Tushum' },
            { value: 'orders', label: 'Buyurtmalar' },
          ]}
        />
      }
    >
      <div className="soft-box" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div className="stat-mini">
          <span className="stat-mini__label">{singleDay ? 'Eng faol soat' : 'Eng faol kun'}</span>
          <span className="stat-mini__value">
            {peak ? chartLabel(peak.at, singleDay, true) : '—'}
          </span>
        </div>
        <div className="stat-mini">
          <span className="stat-mini__label">Pikdagi {metric === 'revenue' ? 'tushum' : 'buyurtmalar'}</span>
          <span className="stat-mini__value" style={{ color: 'var(--primary-ink)' }}>
            {peak ? fmt(pick(peak)) : '—'}
          </span>
        </div>
        <div className="stat-mini">
          <span className="stat-mini__label">Chegirmalar</span>
          <span className="stat-mini__value">{som(sales.discountTotal)}</span>
        </div>
        <div className="stat-mini">
          <span className="stat-mini__label">Oldingi davrga nisbatan</span>
          <span className="stat-mini__value">
            {prevTotal === null ? '—' : (
              <span style={{ color: curTotal >= prevTotal ? 'var(--success-ink)' : 'var(--danger-ink)' }}>
                {curTotal >= prevTotal ? '+' : '−'}
                {metric === 'revenue' ? compactSom(Math.abs(curTotal - prevTotal)) : count(Math.abs(curTotal - prevTotal))}
                {change !== null && <span className="muted" style={{ fontWeight: 500 }}> ({change > 0 ? '+' : ''}{percent(change)})</span>}
              </span>
            )}
          </span>
        </div>
      </div>

      {chart.labels.length === 0 || (sales.ordersCount === 0 && !prevSales?.ordersCount) ? (
        <p className="muted" style={{ textAlign: 'center', padding: '48px 0' }}>
          Bu davrda yakunlangan buyurtma yoʻq
        </p>
      ) : (
        <LineChart
          labels={chart.labels}
          series={series}
          format={fmt}
          height={220}
          xTickEvery={Math.max(1, Math.ceil(chart.labels.length / 9))}
        />
      )}

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
        <div className="legend">
          {series.map((s) => (
            <span key={s.key} className="legend__item">
              <span className="swatch swatch--line" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
        <span className="subtle" style={{ fontSize: 12 }}>Faqat yakunlangan buyurtmalar, qaytarishlar ayirilgan</span>
      </div>
    </Card>
  );
}

/**
 * Lines the two periods up bucket by bucket.
 *
 * Hours for a single day (from 06:00, earlier only if there was trade), days
 * otherwise — the previous period is aligned by position, so "day 3" of this
 * week sits over "day 3" of last week.
 */
function buildChart(
  current: RevenuePoint[],
  previous: RevenuePoint[],
  metric: 'revenue' | 'orders',
  singleDay: boolean,
  period: Period,
) {
  const value = (p: RevenuePoint | undefined) => (p ? (metric === 'revenue' ? p.revenue : p.orders) : 0);

  if (singleDay) {
    const hourOf = (p: RevenuePoint) => Number(p.at.slice(11, 13));
    const all = [...current, ...previous];
    const first = Math.min(6, ...all.map(hourOf));
    const isToday = period.key === 'today';
    const nowHour = new Date().getHours();
    const labels: string[] = [];
    const cur: Array<number | null> = [];
    const prev: Array<number | null> = [];
    for (let h = first; h <= 23; h++) {
      labels.push(`${String(h).padStart(2, '0')}:00`);
      // Hours still to come today are a gap, not a zero.
      cur.push(isToday && h > nowHour ? null : value(current.find((p) => hourOf(p) === h)));
      prev.push(value(previous.find((p) => hourOf(p) === h)));
    }
    return { labels, current: cur, previous: prev };
  }

  const days: string[] = [];
  const start = new Date(`${period.dateFrom}T00:00:00`);
  const end = new Date(`${period.dateTo}T00:00:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  const prevSorted = [...previous].sort((a, b) => a.at.localeCompare(b.at));
  const prevStart = new Date(start);
  prevStart.setDate(prevStart.getDate() - days.length);

  return {
    labels: days.map((d) => chartLabel(d, false)),
    current: days.map((d) => value(current.find((p) => p.at === d))),
    previous: days.map((_, i) => {
      const day = new Date(prevStart);
      day.setDate(day.getDate() + i);
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      return value(prevSorted.find((p) => p.at === key));
    }),
  };
}

function chartLabel(at: string, singleDay: boolean, range = false): string {
  if (singleDay) {
    const h = Number(at.slice(11, 13));
    const hh = String(h).padStart(2, '0');
    return range ? `${hh}:00 – ${String((h + 1) % 24).padStart(2, '0')}:00` : `${hh}:00`;
  }
  return `${at.slice(8, 10)}.${at.slice(5, 7)}`;
}

/* ------------------------------------------------------------------ */
/* Sources and tenders                                                */
/* ------------------------------------------------------------------ */

function SourcesCard({ sales }: { sales: SalesReport }) {
  const by = (...types: string[]) =>
    sales.byType.filter((row) => types.includes(row.type)).reduce((sum, row) => sum + row.count, 0);
  const slices = [
    { key: 'delivery', label: 'Yetkazish', value: by('DELIVERY'), color: 'var(--series-1)' },
    { key: 'hall', label: 'Zalda / QR stol', value: by('DINE_IN', 'TABLE'), color: 'var(--series-2)' },
    { key: 'pickup', label: 'Olib ketish', value: by('PICKUP'), color: 'var(--series-3)' },
  ];
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  return (
    <Card title="Buyurtmalar turi" actions={<IconPieChart size={18} style={{ color: 'var(--text-subtle)' }} />}>
      <div className="row" style={{ gap: 20, alignItems: 'center', flexWrap: 'nowrap' }}>
        <Donut slices={slices} centerLabel="Jami" centerValue={count(total)} size={140} />
        <div className="stack" style={{ gap: 10, flex: 1, minWidth: 0 }}>
          {slices.map((s) => (
            <div key={s.key} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', fontSize: 13 }}>
              <span className="legend__item">
                <span className="swatch" style={{ background: s.color }} />
                {s.label}
              </span>
              <strong className="num">{total > 0 ? percent((s.value / total) * 100, 0) : '—'}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="section-title" style={{ marginTop: 22 }}>Toʻlov usullari</div>
      {sales.byPayment.length === 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Bu davrda toʻlov qayd etilmagan</p>
      ) : (
        <BarList
          rows={sales.byPayment.map((row) => ({
            key: row.method,
            label: PAYMENT_METHOD_LABELS[row.method] ?? row.method,
            value: `${percent(row.sharePercent, 0)} · ${som(row.amount)}`,
            share: row.sharePercent,
          }))}
        />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Active orders                                                      */
/* ------------------------------------------------------------------ */

function ActiveOrdersCard({ query }: { query: UseQueryResult<Paginated<Order>> }) {
  const navigate = useNavigate();
  const items = query.data?.items ?? [];
  const total = query.data?.pagination.total ?? 0;

  return (
    <Card
      flush
      title="Jonli faol buyurtmalar"
      sub="Oshxona va kuryerlar navbatidagi buyurtmalar"
      actions={<span className="pill tone-primary pill--lg">{total} ta faol</span>}
      footer={
        <>
          <span>Koʻrsatilmoqda: {items.length} / {total}</span>
          <Link to="/orders" className="row" style={{ gap: 4, color: 'var(--primary-ink)', fontWeight: 600 }}>
            Barcha buyurtmalar <IconArrowRight size={14} />
          </Link>
        </>
      }
    >
      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <div style={{ padding: 16 }}><ErrorState error={query.error} onRetry={() => void query.refetch()} /></div>
      ) : items.length === 0 ? (
        <p className="muted" style={{ padding: '40px 18px', textAlign: 'center' }}>Hozircha faol buyurtma yoʻq</p>
      ) : (
        <div className="table-wrap">
          <table style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th>Raqam va vaqt</th>
                <th>Tarkibi</th>
                <th>Filial va turi</th>
                <th>Holat</th>
                <th className="td-right">Summa</th>
              </tr>
            </thead>
            <tbody>
              {items.map((order) => (
                <tr key={order.id} className="row--clickable" onClick={() => navigate(`/orders?id=${order.id}`)}>
                  <td>
                    <div className="cell-stack">
                      <span className="cell-main">#{order.displayNumber}</span>
                      <span className="cell-sub">{timeOf(order.createdAt)} · {ago(order.createdAt)}</span>
                    </div>
                  </td>
                  <td style={{ maxWidth: 220 }}>
                    <div className="cell-stack">
                      <span className="ellipsis">{itemsSummary(order)}</span>
                      <span className="cell-sub ellipsis">{order.customerName ?? order.customerPhone ?? 'Mehmon'}</span>
                    </div>
                  </td>
                  <td>
                    <div className="cell-stack">
                      <span>{order.branch?.name ?? '—'}</span>
                      <span className="cell-sub">
                        {ORDER_TYPE_LABELS[order.type] ?? order.type}
                        {order.tableNumber ? ` · Stol ${order.tableNumber}` : ''}
                      </span>
                    </div>
                  </td>
                  <td><StatusBadge status={order.status} /></td>
                  <td className="td-right cell-main num">{som(order.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Top products and branch ranking                                    */
/* ------------------------------------------------------------------ */

function TopProductsCard({
  rows,
  loading,
}: {
  rows: TopProductRow[];
  loading: boolean;
}) {
  return (
    <Card
      title="Top sotilgan taomlar"
      sub="Davrdagi eng koʻp tushum keltirganlar"
      actions={<IconFire size={18} style={{ color: 'var(--primary)' }} />}
    >
      {loading ? (
        <div className="skeleton" style={{ height: 160 }} />
      ) : rows.length === 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Bu davrda sotuv yoʻq</p>
      ) : (
        <ol className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 10 }}>
          {rows.map((row, i) => (
            <li key={row.productId || row.name} className="row" style={{ flexWrap: 'nowrap', gap: 12 }}>
              <span
                className={`avatar avatar--sm ${i === 0 ? '' : 'tone-neutral'}`}
                style={i === 0 ? { background: 'var(--primary)', color: '#fff' } : undefined}
              >
                {i + 1}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cell-main ellipsis">{row.name}</div>
                <div className="cell-sub">{count(row.quantity)} ta sotildi</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="cell-main num">{som(row.revenue)}</div>
                {row.revenueSharePercent !== undefined && (
                  <div className="cell-sub">{percent(row.revenueSharePercent)} ulush</div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function BranchRankingCard({
  rows,
  days,
  loading,
  error,
}: {
  rows: BranchReportRow[];
  days: number;
  loading: boolean;
  error: unknown;
}) {
  return (
    <Card
      title="Filiallar reytingi"
      sub="Tushum va kunlik reja bajarilishi"
      actions={<IconTrophy size={18} style={{ color: 'var(--text-subtle)' }} />}
    >
      {loading ? (
        <div className="skeleton" style={{ height: 140 }} />
      ) : error ? (
        <ErrorState error={error} />
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          {rows.map((row, i) => {
            const target = row.dailyRevenueTarget !== null ? row.dailyRevenueTarget * days : null;
            const done = target ? (row.revenue / target) * 100 : null;
            return (
              <div key={row.branchId} className="bar-row">
                <div className="bar-row__head">
                  <span className="row" style={{ gap: 6 }}>
                    <strong>{i + 1}. {row.branchName}</strong>
                    {i === 0 && row.revenue > 0 && <span className="pill tone-success">Yetakchi</span>}
                  </span>
                  <span className="bar-row__value">
                    <strong style={{ color: 'var(--text)' }}>{compactSom(row.revenue)}</strong> / {row.ordersCount} ta
                  </span>
                </div>
                <div className="progress">
                  <div
                    className="progress__bar"
                    style={{
                      width: `${Math.min(100, done ?? (rows[0]!.revenue > 0 ? (row.revenue / rows[0]!.revenue) * 100 : 0))}%`,
                      background: i === 0 ? 'var(--series-1)' : 'var(--series-2)',
                    }}
                  />
                </div>
                <div className="bar-row__head cell-sub">
                  <span>{target ? `Reja: ${som(target)}` : 'Reja belgilanmagan'}</span>
                  {done !== null && <span style={{ fontWeight: 600 }}>{percent(done)} bajarildi</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function exportDashboard(
  period: Period,
  branchName: string | undefined,
  stats: DashboardStats,
  sales: SalesReport,
  products: TopProductRow[],
) {
  downloadCsv(`dashboard_${period.dateFrom}_${period.dateTo}`, [
    ['Davr', `${period.dateFrom} — ${period.dateTo}`],
    ['Filial', branchName ?? 'Barcha filiallar'],
    [],
    ['Koʻrsatkich', 'Qiymat'],
    ['Tushum (soʻm)', stats.revenue],
    ['Yakunlangan buyurtmalar', stats.ordersCount],
    ['Oʻrtacha chek (soʻm)', stats.averageCheck],
    ['Mijozlar', stats.customersCount],
    ['Yangi mijozlar', stats.newCustomersCount],
    ['Bekor qilingan', stats.cancelledOrders],
    ['Chegirmalar (soʻm)', sales.discountTotal],
    ['Qaytarilgan (soʻm)', sales.refunds],
    [],
    ['Buyurtma turi', 'Soni', 'Tushum (soʻm)'],
    ...sales.byType.map((row) => [ORDER_TYPE_LABELS[row.type] ?? row.type, row.count, row.revenue]),
    [],
    ['Toʻlov usuli', 'Soni', 'Summa (soʻm)', 'Ulush %'],
    ...sales.byPayment.map((row) => [PAYMENT_METHOD_LABELS[row.method] ?? row.method, row.count, row.amount, row.sharePercent]),
    [],
    ['Taom', 'Soni', 'Tushum (soʻm)'],
    ...products.map((row) => [row.name, row.quantity, row.revenue]),
  ]);
}
