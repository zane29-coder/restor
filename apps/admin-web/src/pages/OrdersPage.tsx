import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ORDER_STATUS_TRANSITIONS,
  OrderStatus,
  Permission,
  type Order,
} from '@restor/shared-types';
import { formatMoney } from '@restor/shared-utils';
import { api, RestorApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorState, Empty, Loading } from '../components/States';
import { StatusBadge } from './DashboardPage';

/**
 * Order management (TZ §46).
 *
 * The status buttons are driven by `ORDER_STATUS_TRANSITIONS` from the shared
 * package — the same table the backend validates against — so the UI can never
 * offer a move the API will reject.
 */
export function OrdersPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [status, setStatus] = useState<string>('');
  const [branchId, setBranchId] = useState<string>('');
  const [selected, setSelected] = useState<Order | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const branches = useQuery({
    queryKey: ['branches', 'summary'],
    queryFn: () => api.branches.summaries(),
  });

  const orders = useQuery({
    queryKey: ['orders', status, branchId],
    queryFn: () =>
      api.orders.list({
        status: status ? (status as OrderStatus) : undefined,
        branchId: branchId || undefined,
        limit: 50,
      }),
    refetchInterval: 15_000,
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, next }: { id: string; next: OrderStatus }) =>
      api.orders.updateStatus(id, {
        status: next,
        // The backend refuses a cancellation without a reason (TZ §37).
        ...(next === OrderStatus.CANCELLED ? { cancelReason: 'Admin panelidan bekor qilindi' } : {}),
      }),
    onSuccess: (updated) => {
      setActionError(null);
      setSelected(updated);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (error) => {
      setActionError(error instanceof RestorApiError ? error.message : 'Amal bajarilmadi');
    },
  });

  if (orders.isLoading) return <Loading />;
  if (orders.isError) return <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />;

  const items = orders.data?.items ?? [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="row">
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}
        >
          <option value="">Barcha statuslar</option>
          {Object.values(OrderStatus).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>

        <select
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
        <span className="muted">{orders.data?.pagination.total ?? 0} ta buyurtma</span>
      </div>

      {actionError && <div className="alert alert--error">{actionError}</div>}

      {items.length === 0 ? (
        <Empty title="Buyurtma topilmadi" description="Filtrlarni oʻzgartirib koʻring." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Raqam</th>
                <th>Vaqt</th>
                <th>Filial</th>
                <th>Mijoz</th>
                <th>Turi</th>
                <th>Status</th>
                <th>Summa</th>
                <th>Amallar</th>
              </tr>
            </thead>
            <tbody>
              {items.map((order) => (
                <tr
                  key={order.id}
                  onClick={() => setSelected(order)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    <strong>{order.displayNumber}</strong>
                  </td>
                  <td className="muted">
                    {new Date(order.createdAt).toLocaleTimeString('uz-UZ', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td>{order.branch?.name ?? '—'}</td>
                  <td>{order.customerName ?? order.customerPhone ?? '—'}</td>
                  <td>{order.type}</td>
                  <td>
                    <StatusBadge status={order.status} />
                  </td>
                  <td>{formatMoney(order.total)}</td>
                  <td onClick={(event) => event.stopPropagation()}>
                    {can(Permission.ORDERS_CHANGE_STATUS) ? (
                      <StatusActions
                        order={order}
                        isPending={changeStatus.isPending}
                        onChange={(next) => changeStatus.mutate({ id: order.id, next })}
                      />
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <OrderDetail order={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/** Offers only the transitions the shared state machine allows from here. */
function StatusActions({
  order,
  isPending,
  onChange,
}: {
  order: Order;
  isPending: boolean;
  onChange: (next: OrderStatus) => void;
}) {
  const next = ORDER_STATUS_TRANSITIONS[order.status].filter(
    (candidate) => candidate !== OrderStatus.CANCELLED && candidate !== OrderStatus.REFUNDED,
  );

  if (next.length === 0) return <span className="muted">—</span>;

  return (
    <div className="row" style={{ gap: 6 }}>
      {next.map((candidate) => (
        <button
          key={candidate}
          type="button"
          className="btn btn--ghost"
          style={{ padding: '5px 10px', minHeight: 30, fontSize: 12 }}
          disabled={isPending}
          onClick={() => onChange(candidate)}
        >
          {candidate}
        </button>
      ))}
    </div>
  );
}

function OrderDetail({ order, onClose }: { order: Order; onClose: () => void }) {
  const timeline = useQuery({
    queryKey: ['orders', order.id, 'timeline'],
    queryFn: () => api.orders.timeline(order.id),
  });

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Buyurtma {order.displayNumber}</h2>
        <div className="spacer" />
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Yopish
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18 }}>
        <section>
          <h3 style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Tarkibi
          </h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {order.items.map((item) => (
              <li key={item.id} style={{ marginBottom: 6 }}>
                {item.quantity} × {item.name}
                {item.variantName && <span className="muted"> ({item.variantName})</span>}
                {item.modifiers.length > 0 && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    + {item.modifiers.map((modifier) => modifier.name).join(', ')}
                  </div>
                )}
                <div className="muted" style={{ fontSize: 12 }}>{formatMoney(item.total)}</div>
              </li>
            ))}
          </ul>

          <dl style={{ marginTop: 14, display: 'grid', gap: 4 }}>
            <Row label="Oraliq summa" value={formatMoney(order.subtotal)} />
            {order.discountTotal > 0 && (
              <Row label="Chegirma" value={`−${formatMoney(order.discountTotal)}`} />
            )}
            {order.deliveryFee > 0 && (
              <Row label="Yetkazish" value={formatMoney(order.deliveryFee)} />
            )}
            <Row label="Jami" value={formatMoney(order.total)} strong />
          </dl>
        </section>

        <section>
          <h3 style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Mijoz
          </h3>
          <p style={{ margin: '0 0 4px' }}>{order.customerName ?? '—'}</p>
          <p className="muted" style={{ margin: '0 0 10px' }}>{order.customerPhone ?? '—'}</p>
          {order.deliveryAddress && (
            <p style={{ margin: 0 }}>
              {order.deliveryAddress.address}
              {order.deliveryAddress.apartment && `, ${order.deliveryAddress.apartment}-xonadon`}
            </p>
          )}
          {order.comment && (
            <p className="muted" style={{ marginTop: 10 }}>Izoh: {order.comment}</p>
          )}
        </section>

        <section>
          <h3 style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Tarix
          </h3>
          {timeline.isLoading && <span className="muted">Yuklanmoqda…</span>}
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {timeline.data?.map((entry) => (
              <li key={entry.id} style={{ marginBottom: 6 }}>
                <strong>{entry.toStatus}</strong>
                <div className="muted" style={{ fontSize: 12 }}>
                  {new Date(entry.createdAt).toLocaleTimeString('uz-UZ', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {entry.userName && ` · ${entry.userName}`}
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <dt className="muted">{label}</dt>
      <dd style={{ margin: 0, fontWeight: strong ? 700 : 400 }}>{value}</dd>
    </div>
  );
}
