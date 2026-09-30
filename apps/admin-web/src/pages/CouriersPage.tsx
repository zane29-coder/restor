import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CourierStatus,
  HandoverStatus,
  OrderStatus,
  OrderType,
  Permission,
  type CashHandover,
  type Courier,
  type Order,
} from '@restor/shared-types';
import { formatMoney, formatPhone } from '@restor/shared-utils';
import { IconAlert, IconCheckCircle, IconMapPin, IconPhone } from '@restor/ui';
import { api, RestorApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorState, Loading } from '../components/States';

/**
 * Dispatch (TZ §23-§28).
 *
 * Three things a dispatcher does, in the order they do them: see who is
 * available, put a waiting delivery on one of them, and settle the cash those
 * couriers are carrying at the end of a shift.
 *
 * The courier list refreshes on a timer because it is a live board — a
 * dispatcher reading a stale "available" and assigning to someone who went
 * offline ten minutes ago is the failure this avoids.
 */
export function CouriersPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const couriers = useQuery({
    queryKey: ['couriers'],
    queryFn: () => api.couriers.list({ limit: 100 }),
    refetchInterval: 20_000,
  });

  const waiting = useQuery({
    queryKey: ['orders', 'awaiting-courier'],
    queryFn: () =>
      api.orders.list({
        status: [OrderStatus.READY, OrderStatus.WAITING_COURIER],
        type: OrderType.DELIVERY,
        limit: 50,
      }),
    refetchInterval: 20_000,
  });

  const handovers = useQuery({
    queryKey: ['handovers'],
    queryFn: () => api.couriers.listHandovers({ limit: 50 }),
    refetchInterval: 30_000,
  });

  if (couriers.isLoading) return <Loading />;
  if (couriers.isError) {
    return <ErrorState error={couriers.error} onRetry={() => void couriers.refetch()} />;
  }

  const items = couriers.data?.items ?? [];
  const pending = (handovers.data?.items ?? []).filter(
    (h) => h.status === HandoverStatus.PENDING,
  );
  const unassigned = (waiting.data?.items ?? []).filter((o) => !o.courierId);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['couriers'] });
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
    void queryClient.invalidateQueries({ queryKey: ['handovers'] });
  };

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {notice && (
        <div
          className="card row"
          style={{
            gap: 10,
            background: notice.ok ? '#F0FDF4' : '#FEF2F2',
            borderColor: notice.ok ? '#BBF7D0' : '#FECACA',
          }}
        >
          {notice.ok ? <IconCheckCircle /> : <IconAlert />}
          <span style={{ fontSize: 14 }}>{notice.text}</span>
        </div>
      )}

      {pending.length > 0 && can(Permission.COURIER_WALLET_SETTLE) && (
        <HandoverQueue
          handovers={pending}
          onDone={(text) => {
            setNotice({ ok: true, text });
            invalidate();
          }}
          onError={(text) => setNotice({ ok: false, text })}
        />
      )}

      {unassigned.length > 0 && (
        <UnassignedOrders
          orders={unassigned}
          couriers={items}
          canAssign={can(Permission.ORDERS_ASSIGN_COURIER)}
          onDone={(text) => {
            setNotice({ ok: true, text });
            invalidate();
          }}
          onError={(text) => setNotice({ ok: false, text })}
        />
      )}

      <section>
        <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>
          Kuryerlar <span className="muted">({items.length})</span>
        </h2>

        {items.length === 0 ? (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              Kuryer qoʻshilmagan.
            </p>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 14,
            }}
          >
            {[...items]
              // Available first: that is who the dispatcher is looking for.
              .sort((a, b) => rank(a.status) - rank(b.status))
              .map((courier) => (
                <CourierCard key={courier.id} courier={courier} />
              ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function CourierCard({ courier }: { courier: Courier }) {
  const tone = STATUS_TONE[courier.status];
  const balance = courier.wallet?.balance ?? 0;

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: 15 }}>{courier.fullName}</strong>
        <div className="spacer" />
        <span className="badge" style={{ background: tone.bg, color: tone.fg }}>
          {STATUS_LABEL[courier.status]}
        </span>
      </div>

      <div className="row muted" style={{ gap: 6, fontSize: 13, marginBottom: 10 }}>
        <IconPhone size={14} />
        {formatPhone(courier.phone)}
      </div>

      <dl style={{ display: 'grid', gap: 5, margin: 0, fontSize: 13 }}>
        <Row label="Hozir yetkazmoqda" value={String(courier.activeDeliveryCount ?? 0)} />
        <Row
          label="Qoʻlidagi naqd"
          value={formatMoney(balance)}
          // Cash a courier is carrying is the restaurant's money until it is
          // handed over; a large figure here is what a dispatcher acts on.
          emphasis={balance > 0}
        />
      </dl>

      {courier.lastLocation && (
        <a
          className="row muted"
          style={{ gap: 6, fontSize: 12, marginTop: 10, textDecoration: 'none' }}
          href={`https://maps.google.com/?q=${courier.lastLocation.latitude},${courier.lastLocation.longitude}`}
          target="_blank"
          rel="noreferrer"
        >
          <IconMapPin size={14} />
          Xaritada koʻrish
        </a>
      )}
    </div>
  );
}

/** Deliveries that are ready and have nobody on them. */
function UnassignedOrders({
  orders,
  couriers,
  canAssign,
  onDone,
  onError,
}: {
  orders: Order[];
  couriers: Courier[];
  canAssign: boolean;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  return (
    <section>
      <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>
        Kuryer kutmoqda <span className="muted">({orders.length})</span>
      </h2>
      <div style={{ display: 'grid', gap: 10 }}>
        {orders.map((order) => (
          <AssignRow
            key={order.id}
            order={order}
            couriers={couriers}
            canAssign={canAssign}
            onDone={onDone}
            onError={onError}
          />
        ))}
      </div>
    </section>
  );
}

function AssignRow({
  order,
  couriers,
  canAssign,
  onDone,
  onError,
}: {
  order: Order;
  couriers: Courier[];
  canAssign: boolean;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [courierId, setCourierId] = useState('');

  const assign = useMutation({
    mutationFn: () => api.couriers.assign(order.id, { courierId }),
    onSuccess: () => onDone(`${order.displayNumber} kuryerga biriktirildi`),
    onError: (error) =>
      onError(error instanceof RestorApiError ? error.message : 'Biriktirilmadi'),
  });

  // Offline couriers are not offered: assigning to one produces a job nobody
  // is looking at.
  const available = couriers.filter((c) => c.status !== CourierStatus.OFFLINE && c.isActive);

  return (
    <div className="card row" style={{ gap: 12, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 150 }}>
        <strong>{order.displayNumber}</strong>
        <div className="muted" style={{ fontSize: 13 }}>
          {formatMoney(order.total)}
          {order.paymentStatus !== 'PAID' && ' · naqd olinadi'}
        </div>
      </div>

      <div className="muted" style={{ flex: 1, minWidth: 200, fontSize: 13 }}>
        {order.deliveryAddress?.address ?? '—'}
      </div>

      {canAssign && (
        <>
          <select
            value={courierId}
            onChange={(event) => setCourierId(event.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}
          >
            <option value="">Kuryer tanlang…</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName} ({c.activeDeliveryCount ?? 0})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            disabled={!courierId || assign.isPending}
            onClick={() => assign.mutate()}
          >
            {assign.isPending ? 'Biriktirilmoqda…' : 'Biriktirish'}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Cash couriers have declared and nobody has confirmed.
 *
 * Until a cashier confirms, that money has not moved: the courier's balance
 * still shows it. This queue is the other half of that two-sided handshake.
 */
function HandoverQueue({
  handovers,
  onDone,
  onError,
}: {
  handovers: CashHandover[];
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  return (
    <section>
      <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>
        Kassa topshiruvlari <span className="muted">({handovers.length})</span>
      </h2>
      <div style={{ display: 'grid', gap: 10 }}>
        {handovers.map((handover) => (
          <ConfirmRow
            key={handover.id}
            handover={handover}
            onDone={onDone}
            onError={onError}
          />
        ))}
      </div>
    </section>
  );
}

function ConfirmRow({
  handover,
  onDone,
  onError,
}: {
  handover: CashHandover;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  // Pre-filled with what the courier declared. A cashier who counts something
  // different types it, and the discrepancy is recorded rather than smoothed
  // over -- that difference is the entire reason for two-sided confirmation.
  const [counted, setCounted] = useState(String(handover.amount));

  const amount = Number(counted.replace(/\D/g, '')) || 0;
  const differs = amount !== handover.amount;

  const confirm = useMutation({
    mutationFn: () => api.couriers.confirmHandover(handover.id, { amount }),
    onSuccess: () =>
      onDone(
        differs
          ? `${handover.courierName}: ${formatMoney(amount)} qabul qilindi (farq bilan)`
          : `${handover.courierName}: ${formatMoney(amount)} qabul qilindi`,
      ),
    onError: (error) =>
      onError(error instanceof RestorApiError ? error.message : 'Tasdiqlanmadi'),
  });

  return (
    <div className="card row" style={{ gap: 12, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 160 }}>
        <strong>{handover.courierName}</strong>
        <div className="muted" style={{ fontSize: 13 }}>
          eʼlon qilgan: {formatMoney(handover.amount)}
        </div>
      </div>

      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <label className="muted" style={{ fontSize: 13 }} htmlFor={`c-${handover.id}`}>
          Sanab olindi:
        </label>
        <input
          id={`c-${handover.id}`}
          inputMode="numeric"
          value={counted}
          onChange={(event) => setCounted(event.target.value)}
          style={{
            width: 130,
            padding: '8px 12px',
            borderRadius: 8,
            border: `1px solid ${differs ? '#F59E0B' : 'var(--border)'}`,
          }}
        />
      </div>

      {differs && (
        <span className="badge" style={{ background: '#FEF3C7', color: '#B45309' }}>
          farq {formatMoney(amount - handover.amount)}
        </span>
      )}

      <div className="spacer" />
      <button
        type="button"
        className="btn"
        disabled={amount <= 0 || confirm.isPending}
        onClick={() => confirm.mutate()}
      >
        {confirm.isPending ? 'Tasdiqlanmoqda…' : 'Qabul qildim'}
      </button>
    </div>
  );
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <dt className="muted">{label}</dt>
      <dd style={{ margin: 0, fontWeight: emphasis ? 700 : 400 }}>{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const STATUS_LABEL: Record<CourierStatus, string> = {
  [CourierStatus.OFFLINE]: 'Oflayn',
  [CourierStatus.AVAILABLE]: 'Boʻsh',
  [CourierStatus.ON_DELIVERY]: 'Yoʻlda',
  [CourierStatus.BREAK]: 'Tanaffus',
};

const STATUS_TONE: Record<CourierStatus, { bg: string; fg: string }> = {
  [CourierStatus.OFFLINE]: { bg: '#F3F4F6', fg: '#6B7280' },
  [CourierStatus.AVAILABLE]: { bg: '#DCFCE7', fg: '#166534' },
  [CourierStatus.ON_DELIVERY]: { bg: '#DBEAFE', fg: '#1E40AF' },
  [CourierStatus.BREAK]: { bg: '#FEF3C7', fg: '#B45309' },
};

/** Sort order for the board: who can take a job right now comes first. */
function rank(status: CourierStatus): number {
  switch (status) {
    case CourierStatus.AVAILABLE:
      return 0;
    case CourierStatus.ON_DELIVERY:
      return 1;
    case CourierStatus.BREAK:
      return 2;
    default:
      return 3;
  }
}
