import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { OrderStatus } from '@restor/shared-types';
import { formatMoney } from '@restor/shared-utils';
import { api } from '../lib/api';
import { ErrorState, Loading } from '../components/States';

/**
 * Company dashboard (TZ §7).
 *
 * The figures are derived from the orders endpoint rather than a dedicated
 * reports API: that keeps this screen honest about what the backend can
 * currently prove, and the numbers move to `/reports/dashboard` unchanged once
 * the analytics module lands.
 */
export function DashboardPage() {
  const [branchId, setBranchId] = useState<string>('');

  const branches = useQuery({
    queryKey: ['branches', 'summary'],
    queryFn: () => api.branches.summaries(),
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const orders = useQuery({
    queryKey: ['orders', 'today', branchId],
    queryFn: () =>
      api.orders.list({
        branchId: branchId || undefined,
        dateFrom: today.toISOString(),
        limit: 100,
      }),
    refetchInterval: 30_000,
  });

  if (orders.isLoading) return <Loading />;
  if (orders.isError) return <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />;

  const items = orders.data?.items ?? [];

  const delivered = items.filter((order) => order.status === OrderStatus.DELIVERED);
  const cancelled = items.filter((order) => order.status === OrderStatus.CANCELLED);
  const active = items.filter(
    (order) => order.status !== OrderStatus.DELIVERED && order.status !== OrderStatus.CANCELLED,
  );

  // Revenue counts delivered orders only — a cancelled order never took money.
  const revenue = delivered.reduce((sum, order) => sum + order.total, 0);
  const averageCheck = delivered.length > 0 ? Math.round(revenue / delivered.length) : 0;

  const bySource = (sources: string[]) =>
    items.filter((order) => sources.includes(order.source)).length;

  const customers = new Set(items.map((order) => order.customerPhone).filter(Boolean)).size;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div className="row">
        <label htmlFor="branch" className="muted">
          Filial:
        </label>
        <select
          id="branch"
          value={branchId}
          onChange={(event) => setBranchId(event.target.value)}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}
        >
          <option value="">Barcha filiallar</option>
          {branches.data?.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
        <div className="spacer" />
        <span className="muted">Bugun · {today.toLocaleDateString('uz-UZ')}</span>
      </div>

      <div className="stat-grid">
        <Stat label="Tushum" value={formatMoney(revenue)} hint={`${delivered.length} yetkazilgan`} />
        <Stat label="Buyurtmalar" value={String(items.length)} hint={`${active.length} faol`} />
        <Stat label="Oʻrtacha chek" value={formatMoney(averageCheck)} />
        <Stat label="Mijozlar" value={String(customers)} hint="unikal raqam" />
        <Stat label="Bekor qilingan" value={String(cancelled.length)} />
        <Stat label="Yetkazib berish" value={String(items.filter((o) => o.type === 'DELIVERY').length)} />
        <Stat label="POS" value={String(bySource(['POS']))} />
        <Stat
          label="Online"
          value={String(bySource(['TELEGRAM_MINI_APP', 'TELEGRAM_BOT', 'WEB', 'QR_TABLE']))}
        />
      </div>

      <div className="card">
        <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>Faol buyurtmalar</h2>
        {active.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Hozircha faol buyurtma yoʻq.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Raqam</th>
                  <th>Filial</th>
                  <th>Mijoz</th>
                  <th>Turi</th>
                  <th>Status</th>
                  <th>Summa</th>
                </tr>
              </thead>
              <tbody>
                {active.slice(0, 10).map((order) => (
                  <tr key={order.id}>
                    <td>
                      <strong>{order.displayNumber}</strong>
                    </td>
                    <td>{order.branch?.name ?? '—'}</td>
                    <td>{order.customerName ?? order.customerPhone ?? '—'}</td>
                    <td>{order.type}</td>
                    <td>
                      <StatusBadge status={order.status} />
                    </td>
                    <td>{formatMoney(order.total)}</td>
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

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <p className="stat__label">{label}</p>
      <p className="stat__value">{value}</p>
      {hint && <p className="stat__hint">{hint}</p>}
    </div>
  );
}

/** Colours mirror `@restor/ui`'s `orderStatusColors`, so every screen agrees. */
const STATUS_TONES: Record<string, { bg: string; fg: string }> = {
  NEW: { bg: '#DBEAFE', fg: '#1E40AF' },
  ACCEPTED: { bg: '#E0E7FF', fg: '#3730A3' },
  PREPARING: { bg: '#FEF3C7', fg: '#92400E' },
  READY: { bg: '#DCFCE7', fg: '#166534' },
  WAITING_COURIER: { bg: '#FFEDD5', fg: '#9A3412' },
  COURIER_ASSIGNED: { bg: '#FFE4E6', fg: '#9F1239' },
  ON_DELIVERY: { bg: '#CFFAFE', fg: '#155E75' },
  DELIVERED: { bg: '#DCFCE7', fg: '#14532D' },
  CANCELLED: { bg: '#FEE2E2', fg: '#991B1B' },
  REFUNDED: { bg: '#F3E8FF', fg: '#6B21A8' },
};

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONES[status] ?? { bg: 'var(--surface-alt)', fg: 'var(--text)' };
  return (
    <span className="badge" style={{ background: tone.bg, color: tone.fg }}>
      {status}
    </span>
  );
}
