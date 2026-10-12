import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Permission,
  type BranchReportRow,
  type FinanceReport,
  type SalesReport,
  type TopProductRow,
} from '@restor/shared-types';
import {
  IconBarChart,
  IconBranch,
  IconCash,
  IconCheckCircle,
  IconDownload,
  IconHistory,
  IconOrders,
  IconPieChart,
  IconSearch,
  IconTrendUp,
  IconWallet,
} from '@restor/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useBranch } from '../lib/branch';
import { compactSom, count, dateTimeOf, percent, som, timeOf } from '../lib/format';
import { ORDER_TYPE_LABELS, PAYMENT_METHOD_LABELS, SOURCE_LABELS } from '../lib/labels';
import { buildChart, chartLabel, type ChartGranularity } from '../lib/timeline';
import { BarList, Donut, LineChart, type LineSeries } from '../components/charts';
import { ErrorState, Loading } from '../components/States';
import {
  Card,
  Delta,
  Kpi,
  PageHeader,
  PeriodPicker,
  Seg,
  Tabs,
  changeOf,
  downloadCsv,
  periodDays,
  periodFor,
  previousPeriod,
  type Period,
} from '../components/ui';

type Tab = 'sales' | 'products' | 'finance' | 'branches';
const TABS: Tab[] = ['sales', 'products', 'finance', 'branches'];

/**
 * Reports (TZ 7, 37).
 *
 * Every figure is the server's, computed from orders, payments and shifts on
 * request — revenue is DELIVERED orders net of refunds, everywhere. The
 * screen adds nothing of its own but the comparisons between two server
 * answers.
 */
export function ReportsPage() {
  const { can } = useAuth();
  const { branches, branchId: headerBranch } = useBranch();
  const [params, setParams] = useSearchParams();
  const canFinance = can(Permission.FINANCE_VIEW);

  const requested = params.get('tab') as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) && (requested !== 'finance' || canFinance) ? requested : 'sales';
  const branchId = params.get('branch') ?? headerBranch;
  const [period, setPeriod] = useState<Period>(() => periodFor('30d'));
  const [compare, setCompare] = useState(true);
  const [granularity, setGranularity] = useState<ChartGranularity>('day');

  const setParam = (key: string, value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const days = periodDays(period);
  const grain: ChartGranularity = days <= 1 ? 'hour' : granularity === 'hour' ? 'day' : granularity === 'week' && days < 14 ? 'day' : granularity;
  const query = { branchId: branchId || undefined, dateFrom: period.dateFrom, dateTo: period.dateTo };
  const prev = previousPeriod(period);
  const prevQuery = { ...query, dateFrom: prev.dateFrom, dateTo: prev.dateTo };

  const sales = useQuery({
    queryKey: ['reports', 'sales', query, grain],
    queryFn: () => api.reports.sales({ ...query, granularity: grain }),
    enabled: tab === 'sales',
  });
  const prevSales = useQuery({
    queryKey: ['reports', 'sales', prevQuery, grain],
    queryFn: () => api.reports.sales({ ...prevQuery, granularity: grain }),
    enabled: tab === 'sales',
  });
  const products = useQuery({
    queryKey: ['reports', 'products', query],
    queryFn: () => api.reports.products({ ...query, limit: 200 }),
    enabled: tab === 'sales' || tab === 'products',
  });
  const finance = useQuery({
    queryKey: ['reports', 'finance', query],
    queryFn: () => api.reports.finance(query),
    enabled: canFinance && (tab === 'finance' || tab === 'sales'),
  });
  const branchRows = useQuery({
    queryKey: ['reports', 'branches', { dateFrom: period.dateFrom, dateTo: period.dateTo }],
    queryFn: () => api.reports.branches({ dateFrom: period.dateFrom, dateTo: period.dateTo }),
    enabled: tab === 'branches',
  });

  const exportCurrent = () => {
    const stamp = `${period.dateFrom}_${period.dateTo}`;
    if (tab === 'sales' && sales.data) exportSales(sales.data, stamp);
    if (tab === 'products' && products.data) exportProducts(products.data, stamp);
    if (tab === 'finance' && finance.data) exportFinance(finance.data, stamp);
    if (tab === 'branches' && branchRows.data) exportBranches(branchRows.data, days, stamp);
  };

  return (
    <div className="page">
      <PageHeader
        crumb="Hisobotlar"
        title="Moliya va hisobotlar markazi"
        subtitle="Sof tushum, sotuvlar tahlili, toʻlov turlari, kassa smenalari va filiallar solishtirmasi"
        actions={
          <>
            {tab === 'sales' && (
              <button type="button" className={compare ? 'btn btn--soft' : 'btn btn--ghost'} aria-pressed={compare} onClick={() => setCompare((v) => !v)}>
                <IconTrendUp size={16} /> Davrni solishtirish
              </button>
            )}
            {canFinance && tab !== 'finance' && (
              <button type="button" className="btn btn--ghost" onClick={() => setParam('tab', 'finance')}>
                <IconHistory size={16} /> Z-hisobotlar
              </button>
            )}
            <button type="button" className="btn" onClick={exportCurrent}>
              <IconDownload size={16} /> Eksport (Excel)
            </button>
          </>
        }
      />

      <Tabs
        value={tab}
        onChange={(t) => setParam('tab', t === 'sales' ? '' : t)}
        options={[
          { value: 'sales' as Tab, label: 'Sotuv va tushum', Icon: IconBarChart },
          { value: 'products' as Tab, label: 'Mahsulotlar rentabelligi', Icon: IconPieChart },
          ...(canFinance ? [{ value: 'finance' as Tab, label: 'Moliya va kassa', Icon: IconCash }] : []),
          { value: 'branches' as Tab, label: 'Filiallar solishtirmasi', Icon: IconBranch },
        ]}
      />

      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <PeriodPicker value={period} onChange={setPeriod} />
        <div className="row" style={{ gap: 8 }}>
          {tab !== 'branches' && branches.length > 1 && (
            <select aria-label="Filial" value={branchId} onChange={(e) => setParam('branch', e.target.value)}>
              <option value="">Barcha filiallar ({branches.length} ta)</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          {tab === 'sales' && days > 1 && (
            <Seg
              label="Qadam"
              quiet
              options={[
                { value: 'day' as ChartGranularity, label: 'Kunlik' },
                ...(days >= 14 ? [{ value: 'week' as ChartGranularity, label: 'Haftalik' }] : []),
              ]}
              value={grain}
              onChange={setGranularity}
            />
          )}
        </div>
      </div>

      {tab === 'sales' && (
        sales.isLoading ? <Loading /> : sales.isError ? <ErrorState error={sales.error} onRetry={() => void sales.refetch()} /> : (
          <SalesTab
            sales={sales.data!}
            prevSales={compare ? prevSales.data : undefined}
            products={products.data ?? []}
            finance={canFinance ? finance.data : undefined}
            period={period}
            granularity={grain}
          />
        )
      )}
      {tab === 'products' && (
        products.isLoading ? <Loading /> : products.isError ? <ErrorState error={products.error} onRetry={() => void products.refetch()} /> : <ProductsTab rows={products.data ?? []} />
      )}
      {tab === 'finance' && canFinance && (
        finance.isLoading ? <Loading /> : finance.isError ? <ErrorState error={finance.error} onRetry={() => void finance.refetch()} /> : <FinanceTab report={finance.data!} />
      )}
      {tab === 'branches' && (
        branchRows.isLoading ? <Loading /> : branchRows.isError ? <ErrorState error={branchRows.error} onRetry={() => void branchRows.refetch()} /> : (
          <BranchesTab rows={branchRows.data ?? []} days={days} highlight={params.get('branch')} />
        )
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sales                                                                      */
/* -------------------------------------------------------------------------- */

const WEEKEND = new Set([0, 6]);

function SalesTab({
  sales,
  prevSales,
  products,
  finance,
  period,
  granularity,
}: {
  sales: SalesReport;
  prevSales: SalesReport | undefined;
  products: TopProductRow[];
  finance: FinanceReport | undefined;
  period: Period;
  granularity: ChartGranularity;
}) {
  const chart = useMemo(
    () => buildChart(sales.timeline, prevSales?.timeline ?? [], 'revenue', granularity, period),
    [sales.timeline, prevSales?.timeline, granularity, period],
  );
  const series: LineSeries[] = [
    { key: 'current', label: 'Joriy davr', color: 'var(--series-1)', values: chart.current, area: true },
    ...(prevSales ? [{ key: 'previous', label: 'Oldingi davr', color: 'var(--series-2)', values: chart.previous, dashed: true }] : []),
  ];

  const peak = sales.timeline.reduce<(typeof sales.timeline)[number] | null>((best, p) => (!best || p.revenue > best.revenue ? p : best), null);

  // Weekend against weekday, from the days actually traded — stated only
  // when there are enough of both to mean something.
  const weekendInsight = useMemo(() => {
    if (granularity !== 'day') return null;
    const daily = sales.timeline.map((p) => ({ day: new Date(`${p.at.slice(0, 10)}T12:00:00`).getDay(), revenue: p.revenue }));
    const we = daily.filter((d) => WEEKEND.has(d.day));
    const wd = daily.filter((d) => !WEEKEND.has(d.day));
    if (we.length < 2 || wd.length < 4) return null;
    const avg = (rows: typeof daily) => rows.reduce((s, r) => s + r.revenue, 0) / rows.length;
    const diff = changeOf(avg(we), avg(wd));
    return diff === null || Math.abs(diff) < 5 ? null : diff;
  }, [sales.timeline, granularity]);

  // A month-to-date figure projected to the month's end at the same daily
  // rate — only for "this month", where the projection means something.
  const forecast = useMemo(() => {
    if (period.key !== 'month') return null;
    const today = new Date();
    const elapsed = today.getDate();
    const inMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    return elapsed > 0 ? Math.round((sales.revenue / elapsed) * inMonth) : null;
  }, [period.key, sales.revenue]);

  const margin = sales.costOfGoods !== null && sales.costedRevenue > 0 ? ((sales.costedRevenue - sales.costOfGoods) / sales.costedRevenue) * 100 : null;
  const costedShare = sales.revenue > 0 ? (sales.costedRevenue / sales.revenue) * 100 : 0;

  // Three validated series colours; the tail is folded into "Boshqa".
  const tenders = [...sales.byPayment].sort((a, b) => b.amount - a.amount);
  const paymentTotal = tenders.reduce((s, r) => s + r.amount, 0);
  const slices = [
    ...tenders.slice(0, 3).map((r, i) => ({ key: r.method, label: PAYMENT_METHOD_LABELS[r.method] ?? r.method, value: r.amount, color: `var(--series-${i + 1})` })),
    ...(tenders.length > 3 ? [{ key: 'other', label: 'Boshqa', value: tenders.slice(3).reduce((s, r) => s + r.amount, 0), color: 'var(--text-subtle)' }] : []),
  ];

  const byRevenue = products[0];
  const byQuantity = [...products].sort((a, b) => b.quantity - a.quantity)[0];
  const byMargin = products.filter((p) => p.marginPercent !== null && p.marginPercent !== undefined && p.quantity >= 3).sort((a, b) => b.marginPercent! - a.marginPercent!)[0];

  return (
    <>
      <div className="kpi-grid">
        <Kpi
          label="Jami sof tushum"
          value={compactSom(sales.revenue)}
          unit="soʻm"
          Icon={IconWallet}
          tone="tone-primary"
          foot={
            <>
              <span className="kpi__foot-text"><Delta value={prevSales ? changeOf(sales.revenue, prevSales.revenue) : null} /></span>
              <span>{prevSales ? 'oldingi davrga nisbatan' : `${som(sales.refunds)} qaytarilgan`}</span>
            </>
          }
        />
        <Kpi
          label="Cheklar soni"
          value={count(sales.ordersCount)}
          unit="ta"
          Icon={IconOrders}
          tone="tone-info"
          foot={
            <>
              <span className="kpi__foot-text">Oʻrtacha: {som(sales.averageCheck)}</span>
              <Delta value={prevSales ? changeOf(sales.averageCheck, prevSales.averageCheck) : null} />
            </>
          }
        />
        <Kpi
          label="Tannarx va marja"
          value={margin === null ? '—' : percent(margin)}
          unit={margin === null ? undefined : 'yalpi marja'}
          Icon={IconPieChart}
          tone="tone-success"
          foot={
            <span className="kpi__foot-text" title="Faqat retsepti kiritilgan taomlar boʻyicha">
              {margin === null
                ? 'Taomlarga retsept kiritilmagan'
                : `${compactSom(sales.costedRevenue - sales.costOfGoods!)} yalpi foyda · tushumning ${percent(costedShare, 0)}i boʻyicha`}
            </span>
          }
        />
        {finance ? (
          <Kpi
            label="Kassa: kutilgan va sanalgan"
            value={`${finance.difference > 0 ? '+' : ''}${compactSom(finance.difference)}`}
            unit="soʻm"
            Icon={finance.difference === 0 ? IconCheckCircle : IconCash}
            tone={finance.difference < 0 ? 'tone-danger' : 'tone-success'}
            alert={finance.difference < 0}
            foot={<span>{finance.shiftsCount - finance.openShiftsCount} yopilgan smena{finance.openShiftsCount ? ` · ${finance.openShiftsCount} ochiq` : ''}</span>}
          />
        ) : (
          <Kpi
            label="Chegirmalar"
            value={compactSom(sales.discountTotal)}
            unit="soʻm"
            Icon={IconCash}
            tone="tone-warning"
            foot={<span>Yetkazish: {compactSom(sales.deliveryFees)}</span>}
          />
        )}
      </div>

      <div className="grid-main-side">
        <Card title="Daromad va sotuvlar dinamikasi" sub={prevSales ? 'Oldingi teng davr bilan taqqoslab' : undefined}>
          {weekendInsight !== null && (
            <div className="banner banner--info" style={{ marginBottom: 12 }}>
              <IconTrendUp size={16} />
              <span>
                Dam olish kunlari (Shanba–Yakshanba) oʻrtacha kunlik savdo ish kunlaridan{' '}
                <b>{weekendInsight > 0 ? '+' : ''}{percent(weekendInsight, 0)}</b> {weekendInsight > 0 ? 'yuqori' : 'past'}.
              </span>
            </div>
          )}
          {sales.ordersCount === 0 && !prevSales?.ordersCount ? (
            <p className="muted" style={{ textAlign: 'center', padding: '48px 0' }}>Bu davrda yakunlangan buyurtma yoʻq</p>
          ) : (
            <LineChart labels={chart.labels} series={series} format={som} height={240} xTickEvery={Math.max(1, Math.ceil(chart.labels.length / 9))} />
          )}
          <div className="soft-box" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 14 }}>
            <div className="stat-mini">
              <span className="stat-mini__label">Eng yuqori {granularity === 'hour' ? 'soat' : granularity === 'week' ? 'hafta' : 'kun'}</span>
              <span className="stat-mini__value">{peak ? `${compactSom(peak.revenue)} (${chartLabel(peak.at, granularity, true)})` : '—'}</span>
            </div>
            {forecast !== null && (
              <div className="stat-mini">
                <span className="stat-mini__label">Oy oxirigacha prognoz</span>
                <span className="stat-mini__value" style={{ color: 'var(--primary-ink)' }}>{compactSom(forecast)} soʻm</span>
              </div>
            )}
            <div className="stat-mini">
              <span className="stat-mini__label">Chegirmalar</span>
              <span className="stat-mini__value">{som(sales.discountTotal)}</span>
            </div>
            <div className="stat-mini">
              <span className="stat-mini__label">Yetkazish haqi</span>
              <span className="stat-mini__value">{som(sales.deliveryFees)}</span>
            </div>
          </div>
        </Card>

        <Card title="Toʻlov usullari taqsimoti" actions={<IconCash size={18} style={{ color: 'var(--text-subtle)' }} />}>
          {paymentTotal === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>Bu davrda toʻlov qayd etilmagan</p>
          ) : (
            <>
              <div className="row" style={{ justifyContent: 'center' }}>
                <Donut slices={slices} centerLabel="Jami" centerValue={compactSom(paymentTotal)} size={150} />
              </div>
              <div className="stack" style={{ gap: 8, marginTop: 14 }}>
                {slices.map((s) => (
                  <div key={s.key} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', fontSize: 13 }}>
                    <span className="legend__item"><span className="swatch" style={{ background: s.color }} />{s.label}</span>
                    <span className="num">{som(s.value)} <b>({percent((s.value / paymentTotal) * 100, 0)})</b></span>
                  </div>
                ))}
              </div>
            </>
          )}
          {sales.refunds > 0 && (
            <div className="banner banner--danger" style={{ marginTop: 14 }}>
              <span style={{ flex: 1 }}>Qaytarilgan toʻlovlar</span>
              <b className="num">{som(sales.refunds)}</b>
            </div>
          )}
        </Card>
      </div>

      <div className="grid-3">
        <Highlight title="Eng koʻp daromad keltirgan" product={byRevenue} line={byRevenue ? `${som(byRevenue.revenue)} · ${count(byRevenue.quantity)} dona` : null} />
        <Highlight
          title="Eng yuqori marjali taom"
          product={byMargin}
          line={byMargin ? `${percent(byMargin.marginPercent)} marja · tannarx ${som(byMargin.unitCost ?? 0)}` : 'Retsepti bor taom sotilmagan'}
        />
        <Highlight title="Eng koʻp sotilgan" product={byQuantity} line={byQuantity ? `${count(byQuantity.quantity)} dona · ${som(byQuantity.revenue)}` : null} />
      </div>

      <div className="grid-2">
        <Card title="Manbalar boʻyicha">
          <BarList
            rows={[...sales.bySource].sort((a, b) => b.revenue - a.revenue).map((r) => ({
              key: r.source,
              label: SOURCE_LABELS[r.source] ?? r.source,
              value: `${count(r.count)} ta · ${som(r.revenue)}`,
              share: sales.revenue ? (r.revenue / sales.revenue) * 100 : 0,
            }))}
          />
        </Card>
        <Card title="Buyurtma turi boʻyicha">
          <BarList
            color="var(--series-2)"
            rows={[...sales.byType].sort((a, b) => b.revenue - a.revenue).map((r) => ({
              key: r.type,
              label: ORDER_TYPE_LABELS[r.type] ?? r.type,
              value: `${count(r.count)} ta · ${som(r.revenue)}`,
              share: sales.revenue ? (r.revenue / sales.revenue) * 100 : 0,
            }))}
          />
        </Card>
      </div>
    </>
  );
}

function Highlight({ title, product, line }: { title: string; product: TopProductRow | undefined; line: string | null }) {
  return (
    <div className="card stack" style={{ gap: 4 }}>
      <span className="muted" style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{title}</span>
      <b style={{ fontSize: 15 }}>{product?.name ?? '—'}</b>
      {line && <span className="cell-sub">{line}</span>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Products                                                                   */
/* -------------------------------------------------------------------------- */

function ProductsTab({ rows }: { rows: TopProductRow[] }) {
  const [abc, setAbc] = useState<'' | 'A' | 'B' | 'C'>('');
  const [search, setSearch] = useState('');
  const total = rows.reduce((s, r) => s + r.revenue, 0);
  const classes = (['A', 'B', 'C'] as const).map((c) => {
    const list = rows.filter((r) => r.abcClass === c);
    return { c, count: list.length, revenue: list.reduce((s, r) => s + r.revenue, 0) };
  });
  const visible = rows.filter((r) => (!abc || r.abcClass === abc) && (!search || r.name.toLowerCase().includes(search.toLowerCase())));
  const max = Math.max(...rows.map((r) => r.revenueSharePercent ?? 0), 1);

  if (rows.length === 0) return <p className="card muted" style={{ textAlign: 'center' }}>Bu davrda sotuv yoʻq</p>;

  return (
    <>
      <div className="grid-3">
        {classes.map(({ c, count: n, revenue }) => (
          <button key={c} type="button" className={`card abc-card abc-card--${c.toLowerCase()}${abc === c ? ' is-active' : ''}`} onClick={() => setAbc(abc === c ? '' : c)}>
            <span className="abc-card__letter">{c}</span>
            <span>
              <b>{n} ta taom · {percent(total ? (revenue / total) * 100 : 0, 0)} tushum</b>
              <span className="cell-sub" style={{ display: 'block' }}>
                {c === 'A' ? 'Hech qachon tugamasligi kerak' : c === 'B' ? 'Barqaror, kuzatib boring' : 'Menyudan qisqartirish nomzodlari'}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="card card--flush">
        <div className="card__head">
          <div>
            <h2 className="card__title">Mahsulotlar rentabelligi va ABC tahlili</h2>
            <p className="card__sub">Tannarx — taom retseptidagi xomashyo narxi boʻyicha</p>
          </div>
          <div className="search-input" style={{ minWidth: 220 }}>
            <IconSearch size={15} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Taom nomi…" aria-label="Qidiruv" />
          </div>
        </div>
        <div className="table-wrap">
          <table style={{ minWidth: 780 }}>
            <thead>
              <tr>
                <th>#</th><th>Taom</th><th>ABC</th><th className="td-right">Sotildi</th><th className="td-right">Tushum</th>
                <th style={{ width: 160 }}>Ulush</th><th className="td-right">Tannarx / porsiya</th><th className="td-right">Marja</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={`${r.productId}-${r.name}`}>
                  <td className="muted num">{rows.indexOf(r) + 1}</td>
                  <td className="cell-main">{r.name}</td>
                  <td><span className={`pill ${r.abcClass === 'A' ? 'tone-success' : r.abcClass === 'B' ? 'tone-info' : 'tone-neutral'}`}>{r.abcClass}</span></td>
                  <td className="td-right num">{count(r.quantity)}</td>
                  <td className="td-right num cell-main">{som(r.revenue)}</td>
                  <td>
                    <div className="progress" title={percent(r.revenueSharePercent)}>
                      <div className="progress__bar" style={{ width: `${((r.revenueSharePercent ?? 0) / max) * 100}%` }} />
                    </div>
                  </td>
                  <td className="td-right num">{r.unitCost === null || r.unitCost === undefined ? '—' : som(r.unitCost)}</td>
                  <td className="td-right">
                    {r.marginPercent === null || r.marginPercent === undefined ? (
                      <span className="muted">—</span>
                    ) : (
                      <span className={`pill ${r.marginPercent < 30 ? 'tone-danger' : r.marginPercent < 55 ? 'tone-warning' : 'tone-success'}`}>{percent(r.marginPercent)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Finance                                                                    */
/* -------------------------------------------------------------------------- */

function FinanceTab({ report: f }: { report: FinanceReport }) {
  const closed = f.shifts.filter((s) => s.closedAt);
  const duration = (from: string, to: string | null) => {
    if (!to) return 'ochiq';
    const minutes = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000);
    return `${Math.floor(minutes / 60)} soat ${minutes % 60} daq`;
  };

  return (
    <>
      <div className="kpi-grid">
        <Kpi label="Naqd sotuv" value={compactSom(f.cashSales)} unit="soʻm" Icon={IconCash} tone="tone-primary" foot={<span>{f.shiftsCount} smena</span>} />
        <Kpi label="Karta" value={compactSom(f.cardSales)} unit="soʻm" Icon={IconWallet} tone="tone-info" foot={<span>Terminal orqali</span>} />
        <Kpi label="Onlayn" value={compactSom(f.onlineSales)} unit="soʻm" Icon={IconTrendUp} tone="tone-violet" foot={<span>Click, Payme va boshqalar</span>} />
        <Kpi
          label="Kassa farqi"
          value={`${f.difference > 0 ? '+' : ''}${compactSom(f.difference)}`}
          unit="soʻm"
          Icon={f.difference === 0 ? IconCheckCircle : IconCash}
          tone={f.difference < 0 ? 'tone-danger' : 'tone-success'}
          alert={f.difference < 0}
          foot={<span>{f.discrepancies.length} ta smenada tafovut</span>}
        />
      </div>

      <div className="grid-2">
        <Card title="Inkassatsiya solishtirmasi" sub="Faqat yopilgan smenalar — ochiq smenada hali sanalmagan">
          <dl className="kv">
            <dt>Kutilgan naqd</dt><dd className="num">{som(f.expectedCash)}</dd>
            <dt>Sanalgan naqd</dt><dd className="num">{som(f.countedCash)}</dd>
            <dt>Farq</dt><dd className="num" style={{ color: f.difference < 0 ? 'var(--danger)' : undefined }}>{f.difference > 0 ? '+' : ''}{som(f.difference)}</dd>
            <dt>Ochiq smenalarda</dt><dd className="num">{som(f.cashInOpenShifts)}</dd>
          </dl>
        </Card>
        <Card title="Kassa harakatlari">
          <dl className="kv">
            <dt>Boshlangʻich qoldiqlar</dt><dd className="num">{som(f.openingCash)}</dd>
            <dt>Kassaga kiritildi</dt><dd className="num">{som(f.cashIn)}</dd>
            <dt>Kassadan olindi</dt><dd className="num">{som(f.cashOut)}</dd>
            <dt>Kuryerlardan qabul</dt><dd className="num">{som(f.courierHandovers)}</dd>
            <dt>Qaytarishlar</dt><dd className="num">{som(f.refunds)}</dd>
          </dl>
        </Card>
      </div>

      <div className="card card--flush">
        <div className="card__head">
          <div>
            <h2 className="card__title">Kassir smenalari va inkassatsiya (Z-hisobotlar)</h2>
            <p className="card__sub">Har bir smena boʻyicha kutilgan va sanalgan naqd pul</p>
          </div>
          <span className="pill tone-neutral">{closed.length} ta yopilgan · jami naqd {compactSom(closed.reduce((s, x) => s + (x.actualCash ?? 0), 0))}</span>
        </div>
        {f.shifts.length === 0 ? (
          <p className="muted" style={{ padding: 24, textAlign: 'center' }}>Bu davrda smena ochilmagan</p>
        ) : (
          <div className="table-wrap">
            <table style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th>Filial</th><th>Kassir</th><th>Smena vaqti</th><th className="td-right">Naqd (kutilgan)</th>
                  <th className="td-right">Sanalgan</th><th className="td-right">Farq</th><th className="td-right">Karta va onlayn</th><th>Holat</th>
                </tr>
              </thead>
              <tbody>
                {f.shifts.map((s) => (
                  <tr key={s.shiftId}>
                    <td className="cell-main">{s.branchName}<div className="cell-sub">{s.orderCount} ta chek</div></td>
                    <td>{s.openedByName ?? '—'}{s.closedByName && s.closedByName !== s.openedByName && <div className="cell-sub">yopdi: {s.closedByName}</div>}</td>
                    <td className="cell-sub" style={{ whiteSpace: 'nowrap' }}>
                      {dateTimeOf(s.openedAt)}{s.closedAt ? ` – ${timeOf(s.closedAt)}` : ''}
                      <div>{duration(s.openedAt, s.closedAt)}</div>
                    </td>
                    <td className="td-right num">{som(s.expectedCash)}</td>
                    <td className="td-right num">{s.actualCash === null ? '—' : som(s.actualCash)}</td>
                    <td className="td-right num cell-main" style={{ color: (s.difference ?? 0) < 0 ? 'var(--danger)' : (s.difference ?? 0) > 0 ? 'var(--success)' : undefined }}>
                      {s.difference === null ? '—' : `${s.difference > 0 ? '+' : ''}${som(s.difference)}`}
                    </td>
                    <td className="td-right num">{som(s.cardTotal + s.onlineTotal)}</td>
                    <td><span className={`pill ${s.closedAt ? 'tone-success' : 'tone-warning'}`}>{s.closedAt ? 'Yopilgan' : 'Ochiq'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Branches                                                                   */
/* -------------------------------------------------------------------------- */

function BranchesTab({ rows, days, highlight }: { rows: BranchReportRow[]; days: number; highlight: string | null }) {
  const total = rows.reduce((s, r) => s + r.revenue, 0);
  const best = rows[0];

  if (rows.length === 0) return <p className="card muted" style={{ textAlign: 'center' }}>Filial yoʻq</p>;

  return (
    <>
      <div className="kpi-grid">
        <Kpi label="Tarmoq tushumi" value={compactSom(total)} unit="soʻm" Icon={IconWallet} tone="tone-primary" foot={<span>{rows.length} ta filial</span>} />
        <Kpi label="Yetakchi filial" value={best?.branchName ?? '—'} Icon={IconTrendUp} tone="tone-success" foot={<span>{best ? `${percent(total ? (best.revenue / total) * 100 : 0, 0)} ulush` : ''}</span>} />
        <Kpi
          label="Oʻrtacha chek (tarmoq)"
          value={som(Math.round(total / Math.max(1, rows.reduce((s, r) => s + r.ordersCount, 0))))}
          Icon={IconOrders}
          tone="tone-info"
          foot={<span>{count(rows.reduce((s, r) => s + r.ordersCount, 0))} ta chek</span>}
        />
        <Kpi
          label="Bekor qilinganlar"
          value={count(rows.reduce((s, r) => s + r.cancelledOrders, 0))}
          unit="ta"
          Icon={IconHistory}
          tone="tone-warning"
          foot={<span>Chegirmalar: {compactSom(rows.reduce((s, r) => s + r.discountTotal, 0))}</span>}
        />
      </div>

      <div className="card card--flush">
        <div className="card__head">
          <div>
            <h2 className="card__title">Filiallar solishtirmasi</h2>
            <p className="card__sub">Reja — filialning kunlik maqsadi × davrdagi {days} kun</p>
          </div>
        </div>
        <div className="table-wrap">
          <table style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th>Filial</th><th className="td-right">Tushum</th><th style={{ width: 150 }}>Ulush</th><th className="td-right">Cheklar</th>
                <th className="td-right">Oʻrtacha chek</th><th className="td-right">Bekor</th><th className="td-right">Chegirma</th><th style={{ width: 170 }}>Reja bajarilishi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const target = r.dailyRevenueTarget ? r.dailyRevenueTarget * days : null;
                const done = target ? (r.revenue / target) * 100 : null;
                return (
                  <tr key={r.branchId} className={r.branchId === highlight ? 'row--selected' : undefined} style={{ opacity: r.isActive ? 1 : 0.6 }}>
                    <td className="cell-main">{r.branchName}{!r.isActive && <span className="pill tone-neutral" style={{ marginLeft: 6 }}>nofaol</span>}</td>
                    <td className="td-right num cell-main">{som(r.revenue)}</td>
                    <td>
                      <div className="progress"><div className="progress__bar" style={{ width: `${total ? (r.revenue / total) * 100 : 0}%` }} /></div>
                    </td>
                    <td className="td-right num">{count(r.ordersCount)}</td>
                    <td className="td-right num">{som(r.averageCheck)}</td>
                    <td className="td-right num">{count(r.cancelledOrders)}</td>
                    <td className="td-right num">{som(r.discountTotal)}</td>
                    <td>
                      {done === null ? (
                        <span className="muted">Reja belgilanmagan</span>
                      ) : (
                        <div className="bar-row">
                          <div className="bar-row__head"><span className="cell-sub">{compactSom(target!)}</span><span className="bar-row__value">{percent(done, 0)}</span></div>
                          <div className="progress"><div className={`progress__bar${done >= 100 ? ' progress__bar--ok' : ''}`} style={{ width: `${Math.min(100, done)}%` }} /></div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

function exportSales(s: SalesReport, stamp: string) {
  downloadCsv(`savdo_${stamp}`, [
    ['Koʻrsatkich', 'Qiymat'],
    ['Sof tushum (soʻm)', s.revenue],
    ['Qaytarilgan (soʻm)', s.refunds],
    ['Cheklar', s.ordersCount],
    ['Oʻrtacha chek (soʻm)', s.averageCheck],
    ['Chegirmalar (soʻm)', s.discountTotal],
    ['Yetkazish haqi (soʻm)', s.deliveryFees],
    ['Tannarx (soʻm)', s.costOfGoods ?? ''],
    [],
    ['Davr', 'Tushum (soʻm)', 'Cheklar'],
    ...s.timeline.map((p) => [p.at, p.revenue, p.orders]),
    [],
    ['Toʻlov usuli', 'Summa (soʻm)', 'Soni', 'Ulush %'],
    ...s.byPayment.map((r) => [PAYMENT_METHOD_LABELS[r.method] ?? r.method, r.amount, r.count, r.sharePercent]),
  ]);
}

function exportProducts(rows: TopProductRow[], stamp: string) {
  downloadCsv(`mahsulotlar_${stamp}`, [
    ['Taom', 'ABC', 'Sotildi', 'Tushum (soʻm)', 'Ulush %', 'Tannarx/porsiya (soʻm)', 'Marja %'],
    ...rows.map((r) => [r.name, r.abcClass, r.quantity, r.revenue, r.revenueSharePercent, r.unitCost ?? '', r.marginPercent ?? '']),
  ]);
}

function exportFinance(f: FinanceReport, stamp: string) {
  downloadCsv(`kassa_${stamp}`, [
    ['Filial', 'Kassir', 'Ochildi', 'Yopildi', 'Kutilgan naqd', 'Sanalgan', 'Farq', 'Karta', 'Onlayn', 'Cheklar'],
    ...f.shifts.map((s) => [s.branchName, s.openedByName, s.openedAt, s.closedAt, s.expectedCash, s.actualCash, s.difference, s.cardTotal, s.onlineTotal, s.orderCount]),
  ]);
}

function exportBranches(rows: BranchReportRow[], days: number, stamp: string) {
  downloadCsv(`filiallar_${stamp}`, [
    ['Filial', 'Tushum (soʻm)', 'Cheklar', 'Oʻrtacha chek', 'Bekor', 'Chegirma', 'Reja (soʻm)'],
    ...rows.map((r) => [r.branchName, r.revenue, r.ordersCount, r.averageCheck, r.cancelledOrders, r.discountTotal, r.dailyRevenueTarget ? r.dailyRevenueTarget * days : '']),
  ]);
}
