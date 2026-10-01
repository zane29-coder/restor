import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  OrderSource,
  OrderType,
  PaymentMethod,
  Permission,
  type FinanceReport,
  type SalesReport,
  type TopProductRow,
} from '@restor/shared-types';
import { formatMoney } from '@restor/shared-utils';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorState, Loading } from '../components/States';

type Tab = 'sales' | 'products' | 'finance';

/**
 * Reporting (TZ §7, §37).
 *
 * Every figure is computed from live orders, payments and shifts, so nothing
 * here can disagree with the operations screens.
 *
 * The date range defaults to the last 30 days and the boundaries are resolved
 * in the BRANCH's timezone server-side — a report that starts at 05:00
 * because the server runs UTC quietly moves five hours of trade into the
 * wrong day.
 */
export function ReportsPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('sales');
  const [branchId, setBranchId] = useState('');
  const [dateFrom, setDateFrom] = useState(isoDaysAgo(29));
  const [dateTo, setDateTo] = useState(isoDaysAgo(0));

  const branches = useQuery({
    queryKey: ['branches', 'summary'],
    queryFn: () => api.branches.summaries(),
  });

  const range = {
    ...(branchId ? { branchId } : {}),
    dateFrom,
    dateTo,
  };

  const canSeeFinance = can(Permission.FINANCE_VIEW);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={control}>
          <option value="">Barcha filiallar</option>
          {branches.data?.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>

        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={control} />
        <span className="muted">—</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={control} />

        <div className="spacer" />

        {(
          [
            ['sales', 'Sotuv'],
            ['products', 'Mahsulotlar'],
            ...(canSeeFinance ? ([['finance', 'Moliya']] as const) : []),
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'btn' : 'btn btn--ghost'}
            onClick={() => setTab(key as Tab)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'sales' && <SalesTab range={range} />}
      {tab === 'products' && <ProductsTab range={range} />}
      {tab === 'finance' && canSeeFinance && <FinanceTab range={range} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SalesTab({ range }: { range: Record<string, string> }) {
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');

  const report = useQuery({
    queryKey: ['reports', 'sales', range, granularity],
    queryFn: () => api.reports.sales({ ...range, granularity }),
  });

  if (report.isLoading) return <Loading />;
  if (report.isError) {
    return <ErrorState error={report.error} onRetry={() => void report.refetch()} />;
  }
  if (!report.data) return null;

  const data: SalesReport = report.data;
  const peak = Math.max(1, ...data.timeline.map((point) => point.revenue));

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={cardGrid}>
        <Stat label="Tushum" value={formatMoney(data.revenue)} big />
        <Stat label="Buyurtma" value={String(data.ordersCount)} big />
        <Stat label="Oʻrtacha chek" value={formatMoney(data.averageCheck)} />
        <Stat label="Chegirmalar" value={formatMoney(data.discountTotal)} />
        <Stat label="Yetkazish haqi" value={formatMoney(data.deliveryFees)} />
        <Stat label="Qaytarilgan" value={formatMoney(data.refunds)} tone={data.refunds > 0 ? 'warn' : undefined} />
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 14 }}>
          <h3 style={{ fontSize: 15, margin: 0 }}>Tushum dinamikasi</h3>
          <div className="spacer" />
          {(['day', 'week', 'month'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={granularity === value ? 'btn' : 'btn btn--ghost'}
              style={{ padding: '5px 12px', minHeight: 30, fontSize: 12 }}
              onClick={() => setGranularity(value)}
            >
              {value === 'day' ? 'Kun' : value === 'week' ? 'Hafta' : 'Oy'}
            </button>
          ))}
        </div>

        {data.timeline.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Bu davrda sotuv yoʻq.</p>
        ) : (
          /*
            A CSS bar chart rather than a charting library: this is one series
            of at most a few dozen points, and a dependency for it would cost
            more than it returns.
          */
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 160 }}>
            {data.timeline.map((point) => (
              <div
                key={point.at}
                title={`${point.at}: ${formatMoney(point.revenue)} · ${point.orders} ta`}
                style={{
                  flex: 1,
                  minWidth: 4,
                  height: `${Math.max(2, (point.revenue / peak) * 100)}%`,
                  background: 'var(--primary, #FF6B00)',
                  borderRadius: '3px 3px 0 0',
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        <Breakdown
          title="Buyurtma turi"
          rows={data.byType.map((row) => ({
            label: ORDER_TYPE_LABEL[row.type] ?? row.type,
            count: row.count,
            amount: row.revenue,
          }))}
        />
        <Breakdown
          title="Kanal"
          rows={data.bySource.map((row) => ({
            label: SOURCE_LABEL[row.source] ?? row.source,
            count: row.count,
            amount: row.revenue,
          }))}
        />
        <Breakdown
          title="Toʻlov turi"
          rows={data.byPayment.map((row) => ({
            label: PAYMENT_LABEL[row.method] ?? row.method,
            count: row.count,
            amount: row.amount,
            share: row.sharePercent,
          }))}
        />
      </div>
    </div>
  );
}

function ProductsTab({ range }: { range: Record<string, string> }) {
  const report = useQuery({
    queryKey: ['reports', 'products', range],
    queryFn: () => api.reports.products({ ...range, limit: 100 }),
  });

  if (report.isLoading) return <Loading />;
  if (report.isError) {
    return <ErrorState error={report.error} onRetry={() => void report.refetch()} />;
  }

  const rows: TopProductRow[] = report.data ?? [];
  if (rows.length === 0) {
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>Bu davrda sotilgan mahsulot yoʻq.</p>
      </div>
    );
  }

  const counts = { A: 0, B: 0, C: 0 };
  for (const row of rows) if (row.abcClass) counts[row.abcClass] += 1;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="card">
        <h3 style={{ fontSize: 15, margin: '0 0 6px' }}>ABC tahlil</h3>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
          A — tushumning 80% i ({counts.A} ta): bular hech qachon tugamasligi kerak.
          B — keyingi 15% ({counts.B} ta). C — qolgani ({counts.C} ta): menyudan
          chiqarish mumkin boʻlganlar.
        </p>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Mahsulot</th>
              <th>Sotildi</th>
              <th>Tushum</th>
              <th>Ulush</th>
              <th>ABC</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.productId || row.name}>
                <td className="muted">{index + 1}</td>
                <td><strong>{row.name}</strong></td>
                <td>{row.quantity}</td>
                <td>{formatMoney(row.revenue)}</td>
                <td className="muted">{row.revenueSharePercent}%</td>
                <td>
                  <span className="badge" style={ABC_TONE[row.abcClass ?? 'C']}>
                    {row.abcClass}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FinanceTab({ range }: { range: Record<string, string> }) {
  const report = useQuery({
    queryKey: ['reports', 'finance', range],
    queryFn: () => api.reports.finance(range),
  });

  if (report.isLoading) return <Loading />;
  if (report.isError) {
    return <ErrorState error={report.error} onRetry={() => void report.refetch()} />;
  }
  if (!report.data) return null;

  const data: FinanceReport = report.data;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={cardGrid}>
        <Stat label="Smenalar" value={String(data.shiftsCount)} big />
        <Stat label="Naqd savdo" value={formatMoney(data.cashSales)} big />
        <Stat label="Karta" value={formatMoney(data.cardSales)} />
        <Stat label="Onlayn" value={formatMoney(data.onlineSales)} />
        <Stat label="Kuryerdan" value={formatMoney(data.courierHandovers)} />
        <Stat
          label="Umumiy farq"
          value={formatMoney(data.difference)}
          tone={data.difference < 0 ? 'bad' : data.difference > 0 ? 'warn' : undefined}
        />
      </div>

      {/*
        Spelled out because the three figures must visibly tie. The
        reconciliation covers CLOSED shifts only; anything still in an open
        drawer is shown separately rather than counted as a shortage.
      */}
      <div className="card">
        <h3 style={{ fontSize: 15, margin: '0 0 12px' }}>Kassa solishtiruvi</h3>
        <div style={{ display: 'grid', gap: 6, fontSize: 14, maxWidth: 420 }}>
          <Line label="Yopilgan smenalarda kutilgan" value={data.expectedCash} />
          <Line label="Sanab olingan" value={data.countedCash} />
          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
          <Line label="Farq" value={data.difference} strong />
          {data.openShiftsCount > 0 && (
            <p className="muted" style={{ fontSize: 13, margin: '10px 0 0' }}>
              Yana {data.openShiftsCount} ta smena ochiq — ularda{' '}
              <strong>{formatMoney(data.cashInOpenShifts)}</strong> turibdi, hali
              sanalmagani uchun solishtiruvga kirmadi.
            </p>
          )}
        </div>
      </div>

      <div className="card">
        <h3 style={{ fontSize: 15, margin: '0 0 12px' }}>
          Farq bilan yopilgan smenalar{' '}
          <span className="muted">({data.discrepancies.length})</span>
        </h3>

        {data.discrepancies.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Hamma smena farqsiz yopilgan.
          </p>
        ) : (
          /*
            This list is the point of the report. The totals tell an owner how
            the month went; this tells them which evening to ask about.
          */
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Yopilgan</th>
                  <th>Kassir</th>
                  <th>Kutilgan</th>
                  <th>Sanalgan</th>
                  <th>Farq</th>
                  <th>Izoh</th>
                </tr>
              </thead>
              <tbody>
                {data.discrepancies.map((row) => (
                  <tr key={row.shiftId}>
                    <td>
                      {row.closedAt
                        ? new Date(row.closedAt).toLocaleString('uz-UZ')
                        : '—'}
                    </td>
                    <td>{row.closedByName ?? '—'}</td>
                    <td>{formatMoney(row.expectedCash)}</td>
                    <td>{formatMoney(row.actualCash ?? 0)}</td>
                    <td>
                      <strong style={{ color: row.difference < 0 ? '#991B1B' : '#B45309' }}>
                        {row.difference > 0 ? '+' : ''}
                        {formatMoney(row.difference)}
                      </strong>
                    </td>
                    <td className="muted">{row.comment ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Stat({
  label,
  value,
  big,
  tone,
}: {
  label: string;
  value: string;
  big?: boolean;
  tone?: 'warn' | 'bad';
}) {
  const color = tone === 'bad' ? '#991B1B' : tone === 'warn' ? '#B45309' : undefined;
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: big ? 24 : 18, fontWeight: 800, marginTop: 4, color }}>
        {value}
      </div>
    </div>
  );
}

function Line({
  label,
  value,
  strong,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <span className={strong ? undefined : 'muted'}>{label}</span>
      <span
        style={{
          fontWeight: strong ? 800 : 600,
          color: strong && value < 0 ? '#991B1B' : strong && value > 0 ? '#B45309' : undefined,
        }}
      >
        {strong && value > 0 ? '+' : ''}
        {formatMoney(value)}
      </span>
    </div>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; count: number; amount: number; share?: number }>;
}) {
  return (
    <div className="card">
      <h3 style={{ fontSize: 14, margin: '0 0 12px' }}>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>—</p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map((row) => (
            <div key={row.label} className="row" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13 }}>
                {row.label} <span className="muted">({row.count})</span>
              </span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {formatMoney(row.amount)}
                {row.share !== undefined && (
                  <span className="muted" style={{ fontWeight: 400 }}> · {row.share}%</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const control = {
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  fontSize: 14,
} as const;

const cardGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 12,
} as const;

const ABC_TONE: Record<'A' | 'B' | 'C', { background: string; color: string }> = {
  A: { background: '#DCFCE7', color: '#166534' },
  B: { background: '#FEF3C7', color: '#B45309' },
  C: { background: '#F3F4F6', color: '#6B7280' },
};

const ORDER_TYPE_LABEL: Record<string, string> = {
  [OrderType.DELIVERY]: 'Yetkazish',
  [OrderType.PICKUP]: 'Olib ketish',
  [OrderType.DINE_IN]: 'Zalda',
  [OrderType.TABLE]: 'Stolda',
};

const SOURCE_LABEL: Record<string, string> = {
  [OrderSource.POS]: 'Kassa',
  [OrderSource.WEB]: 'Sayt',
  [OrderSource.TELEGRAM_BOT]: 'Telegram bot',
  [OrderSource.TELEGRAM_MINI_APP]: 'Mini App',
  [OrderSource.QR_TABLE]: 'Stol QR',
  [OrderSource.CALL_CENTER]: 'Call-markaz',
  [OrderSource.ADMIN]: 'Admin',
};

const PAYMENT_LABEL: Record<string, string> = {
  [PaymentMethod.CASH]: 'Naqd',
  [PaymentMethod.CARD]: 'Karta',
  [PaymentMethod.TERMINAL]: 'Terminal',
  [PaymentMethod.SUBO]: 'Onlayn (Subo)',
  [PaymentMethod.CLICK]: 'Click',
  [PaymentMethod.PAYME]: 'Payme',
  [PaymentMethod.QR]: 'QR',
  [PaymentMethod.BONUS]: 'Bonus',
};

/** `YYYY-MM-DD` for a date N days back, in the browser's own zone. */
function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}
