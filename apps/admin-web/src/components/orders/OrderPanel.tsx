import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ORDER_STATUS_TRANSITIONS,
  OrderStatus,
  OrderType,
  Permission,
  type Order,
} from '@restor/shared-types';
import {
  IconAlert,
  IconCheckCircle,
  IconClock,
  IconClose,
  IconCourier,
  IconMapPin,
  IconNote,
  IconPhone,
  IconPrint,
  IconUser,
} from '@restor/ui';
import { api, RestorApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { ago, initialsOf, phone, som, timeOf } from '../../lib/format';
import {
  COURIER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONES,
  SOURCE_LABELS,
  STATUS_LABELS,
  VEHICLE_LABELS,
} from '../../lib/labels';
import { printOrder } from '../../lib/print';
import { SidePanel } from '../ui';
import { StatusBadge } from '../StatusBadge';
import { ErrorState, Loading } from '../States';

/** The wording on the button that moves an order to each status. */
const ADVANCE_LABELS: Partial<Record<OrderStatus, string>> = {
  ACCEPTED: 'Qabul qilish',
  PREPARING: 'Oshxonaga yuborish',
  READY: 'Tayyor deb belgilash',
  WAITING_COURIER: 'Kuryerga uzatish',
  ON_DELIVERY: 'Yoʻlga chiqdi',
  DELIVERED: 'Topshirildi deb belgilash',
};

/**
 * One order, opened beside the list.
 *
 * The action buttons come from `ORDER_STATUS_TRANSITIONS` — the table the
 * backend validates against — so the panel never offers a move the API will
 * refuse. The order is re-fetched while open, so a status the kitchen changed
 * a moment ago is what the operator sees.
 */
export function OrderPanel({
  orderId,
  initial,
  onClose,
}: {
  orderId: string;
  initial?: Order;
  onClose: () => void;
}) {
  const { user, can } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [assigning, setAssigning] = useState(false);

  const order = useQuery({
    queryKey: ['orders', 'one', orderId],
    queryFn: () => api.orders.get(orderId),
    initialData: initial,
    refetchInterval: 15_000,
  });
  const timeline = useQuery({
    queryKey: ['orders', 'one', orderId, 'timeline'],
    queryFn: () => api.orders.timeline(orderId),
  });
  const payments = useQuery({
    queryKey: ['orders', 'one', orderId, 'payments'],
    queryFn: () => api.payments.listForOrder(orderId),
    enabled: can(Permission.PAYMENTS_VIEW),
  });
  // The customer's standing note ("piyozsiz") belongs next to every order.
  const customerId = order.data?.customerId;
  const customer = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => api.customers.get(customerId!),
    enabled: Boolean(customerId) && can(Permission.CUSTOMERS_VIEW),
  });
  const courierId = order.data?.courierId;
  const courier = useQuery({
    queryKey: ['couriers', 'one', courierId],
    queryFn: () => api.couriers.get(courierId!),
    enabled: Boolean(courierId) && can(Permission.COURIERS_VIEW),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
    void queryClient.invalidateQueries({ queryKey: ['live'] });
  };

  const changeStatus = useMutation({
    mutationFn: (payload: { status: OrderStatus; cancelReason?: string }) =>
      api.orders.updateStatus(orderId, payload),
    onSuccess: () => {
      setError(null);
      setCancelling(false);
      setReason('');
      refresh();
    },
    onError: (e) => setError(e instanceof RestorApiError ? e.message : 'Amal bajarilmadi'),
  });

  if (order.isLoading) {
    return (
      <SidePanel title="Buyurtma" onClose={onClose}>
        <Loading />
      </SidePanel>
    );
  }
  if (order.isError || !order.data) {
    return (
      <SidePanel title="Buyurtma" onClose={onClose}>
        <ErrorState error={order.error} onRetry={() => void order.refetch()} />
      </SidePanel>
    );
  }

  const o = order.data;
  const next = ORDER_STATUS_TRANSITIONS[o.status].filter(
    (s) => s !== OrderStatus.CANCELLED && s !== OrderStatus.REFUNDED,
  );
  const canChange = can(Permission.ORDERS_CHANGE_STATUS);
  const canCancel =
    (can(Permission.ORDERS_CANCEL) || canChange) &&
    ORDER_STATUS_TRANSITIONS[o.status].includes(OrderStatus.CANCELLED);
  const needsCourier =
    o.type === OrderType.DELIVERY &&
    (o.status === OrderStatus.WAITING_COURIER || o.status === OrderStatus.COURIER_ASSIGNED || o.status === OrderStatus.READY) &&
    can(Permission.ORDERS_ASSIGN_COURIER);

  const address = o.deliveryAddress;
  const itemCount = o.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <SidePanel
      title={`#${o.displayNumber}`}
      sub={`${SOURCE_LABELS[o.source] ?? o.source} orqali · ${ORDER_TYPE_LABELS[o.type] ?? o.type}${o.tableNumber ? ` · Stol ${o.tableNumber}` : ''}`}
      onClose={onClose}
      headerExtra={
        <button
          type="button"
          className="icon-btn icon-btn--sm"
          title="Chekni chop etish"
          aria-label="Chekni chop etish"
          onClick={() => printOrder(o, user?.tenantName ?? 'RESTOR')}
        >
          <IconPrint size={18} />
        </button>
      }
      footer={
        <>
          {error && (
            <div className="alert alert--error" style={{ margin: 0 }} role="alert">
              {error}
            </div>
          )}
          {cancelling ? (
            <div className="stack" style={{ gap: 8 }}>
              <label className="field__label" htmlFor="cancel-reason">Bekor qilish sababi</label>
              <textarea
                id="cancel-reason"
                rows={2}
                value={reason}
                autoFocus
                placeholder="Masalan: mijoz telefonni koʻtarmadi"
                onChange={(event) => setReason(event.target.value)}
              />
              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn btn--danger"
                  style={{ flex: 1 }}
                  disabled={!reason.trim() || changeStatus.isPending}
                  onClick={() => changeStatus.mutate({ status: OrderStatus.CANCELLED, cancelReason: reason.trim() })}
                >
                  Bekor qilishni tasdiqlash
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setCancelling(false)}>
                  Orqaga
                </button>
              </div>
            </div>
          ) : (
            <>
              {canChange &&
                next.map((status, i) => (
                  <button
                    key={status}
                    type="button"
                    className={`btn btn--block ${i === 0 ? '' : 'btn--ghost'}`}
                    disabled={changeStatus.isPending}
                    onClick={() => changeStatus.mutate({ status })}
                  >
                    <IconCheckCircle size={17} />
                    {ADVANCE_LABELS[status] ?? `→ ${STATUS_LABELS[status] ?? status}`}
                  </button>
                ))}
              {needsCourier && (
                <button type="button" className="btn btn--dark btn--block" onClick={() => setAssigning((v) => !v)}>
                  <IconCourier size={17} />
                  {o.courierId ? 'Kuryerni almashtirish' : 'Kuryer biriktirish'}
                </button>
              )}
              {canCancel && (
                <button type="button" className="btn btn--danger-soft btn--block" onClick={() => setCancelling(true)}>
                  <IconClose size={16} />
                  Bekor qilish
                </button>
              )}
            </>
          )}
        </>
      }
    >
      <div className="row" style={{ gap: 8 }}>
        <StatusBadge status={o.status} />
        <span className="row muted" style={{ gap: 4, fontSize: 12 }}>
          <IconClock size={14} />
          {timeOf(o.createdAt)} da kelgan · {ago(o.createdAt)}
        </span>
      </div>

      {o.status === OrderStatus.CANCELLED && o.cancelReason && (
        <div className="banner banner--danger" style={{ padding: 10 }}>
          <IconAlert size={16} />
          <span>Bekor qilish sababi: {o.cancelReason}</span>
        </div>
      )}

      {assigning && needsCourier && (
        <AssignCourier orderId={o.id} onDone={() => { setAssigning(false); refresh(); }} />
      )}

      {/* Customer */}
      <section className="detail-section">
        <div className="detail-section__title">
          <span className="row" style={{ gap: 6 }}><IconUser size={14} /> Mijoz</span>
          {o.customerPhone && (
            <a href={`tel:${o.customerPhone}`} className="btn btn--sm btn--soft">
              <IconPhone size={14} /> Qoʻngʻiroq
            </a>
          )}
        </div>
        <div className="soft-box stack" style={{ gap: 8 }}>
          <div>
            <div className="cell-main">{o.customerName ?? 'Mehmon'}</div>
            <div className="cell-sub">{o.customerPhone ? phone(o.customerPhone) : 'Telefon koʻrsatilmagan'}</div>
          </div>
          {address && (
            <div className="row" style={{ gap: 6, alignItems: 'flex-start', flexWrap: 'nowrap', fontSize: 13 }}>
              <IconMapPin size={15} style={{ marginTop: 2, color: 'var(--text-muted)' }} />
              <div>
                {[
                  address.address,
                  address.entrance && `${address.entrance}-podyezd`,
                  address.floor && `${address.floor}-qavat`,
                  address.apartment && `${address.apartment}-xonadon`,
                ]
                  .filter(Boolean)
                  .join(', ')}
                {address.landmark && <div className="cell-sub">Moʻljal: {address.landmark}</div>}
                {address.intercom && <div className="cell-sub">Domofon: {address.intercom}</div>}
              </div>
            </div>
          )}
          {customer.data?.notes && (
            <div className="banner banner--info" style={{ padding: 8, fontSize: 12.5 }}>
              <IconNote size={15} />
              <span><strong>Mijoz eslatmasi:</strong> {customer.data.notes}</span>
            </div>
          )}
          {(o.comment || o.courierComment || address?.comment) && (
            <div className="banner banner--warning" style={{ padding: 8, fontSize: 12.5 }}>
              <IconNote size={15} />
              <span>
                {[o.comment, address?.comment, o.courierComment && `Kuryerga: ${o.courierComment}`]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Courier */}
      {o.type === OrderType.DELIVERY && (
        <section className="detail-section">
          <div className="detail-section__title">
            <span className="row" style={{ gap: 6 }}><IconCourier size={14} /> Kuryer</span>
          </div>
          {o.courierId ? (
            <div className="soft-box row" style={{ flexWrap: 'nowrap' }}>
              <span className="avatar">{initialsOf(courier.data?.fullName)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cell-main ellipsis">{courier.data?.fullName ?? 'Biriktirilgan'}</div>
                <div className="cell-sub">
                  {courier.data
                    ? `${phone(courier.data.phone)} · ${VEHICLE_LABELS[courier.data.vehicleType] ?? courier.data.vehicleType}`
                    : '—'}
                </div>
              </div>
              {courier.data && <span className="pill tone-info">{COURIER_STATUS_LABELS[courier.data.status] ?? courier.data.status}</span>}
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>Hali kuryer biriktirilmagan</p>
          )}
        </section>
      )}

      {/* Items */}
      <section className="detail-section">
        <div className="detail-section__title">
          <span>Buyurtma tarkibi</span>
          <span className="pill tone-neutral">{o.items.length} xil · {itemCount} ta</span>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          {o.items.map((item) => (
            <div key={item.id} className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <span className="avatar avatar--sm tone-primary" style={{ borderRadius: 8 }}>{item.quantity}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cell-main">{item.name}{item.variantName && <span className="muted"> · {item.variantName}</span>}</div>
                {item.modifiers.length > 0 && (
                  <div className="cell-sub">+ {item.modifiers.map((m) => m.name).join(', ')}</div>
                )}
                {item.comment && <div className="cell-sub">“{item.comment}”</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="cell-main num">{som(item.total)}</div>
                <div className="cell-sub num">{som(item.unitPrice)} × {item.quantity}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Totals */}
      <section className="soft-box">
        <dl className="kv">
          <dt>Mahsulotlar</dt>
          <dd>{som(o.subtotal)}</dd>
          {o.discountTotal > 0 && (
            <>
              <dt>Chegirma</dt>
              <dd style={{ color: 'var(--success-ink)' }}>−{som(o.discountTotal)}</dd>
            </>
          )}
          {o.appliedPromotions.map((p) => (
            <span key={`${p.promotionId ?? p.promoCodeId}-${p.name}`} style={{ display: 'contents' }}>
              <dt className="cell-sub">· {p.name}</dt>
              <dd className="cell-sub">−{som(p.amount)}</dd>
            </span>
          ))}
          {o.deliveryFee > 0 && (
            <>
              <dt>Yetkazib berish</dt>
              <dd>{som(o.deliveryFee)}</dd>
            </>
          )}
          {o.serviceFee > 0 && (
            <>
              <dt>Xizmat haqi</dt>
              <dd>{som(o.serviceFee)}</dd>
            </>
          )}
          <dt style={{ fontWeight: 700, color: 'var(--text)', paddingTop: 6 }}>Jami</dt>
          <dd style={{ fontSize: 18, paddingTop: 6, color: 'var(--primary-ink)' }}>{som(o.total)}</dd>
        </dl>
        <div className="row" style={{ marginTop: 10, justifyContent: 'space-between', fontSize: 12.5 }}>
          <span className="muted">
            Toʻlov: {o.paymentMethod ? (PAYMENT_METHOD_LABELS[o.paymentMethod] ?? o.paymentMethod) : '—'}
            {o.paymentProvider && ` (${o.paymentProvider})`}
          </span>
          <span className={`pill ${PAYMENT_STATUS_TONES[o.paymentStatus] ?? 'tone-neutral'}`}>
            {PAYMENT_STATUS_LABELS[o.paymentStatus] ?? o.paymentStatus}
          </span>
        </div>
        {payments.data && payments.data.length > 0 && (
          <div className="stack" style={{ gap: 4, marginTop: 8 }}>
            {payments.data.map((p) => (
              <div key={p.id} className="row cell-sub" style={{ justifyContent: 'space-between' }}>
                <span>{PAYMENT_METHOD_LABELS[p.method] ?? p.method}{p.paidAt ? ` · ${timeOf(p.paidAt)}` : ''}</span>
                <span className="num">{som(p.amount)}{p.status !== 'SUCCESS' ? ` (${p.status.toLowerCase()})` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Timeline */}
      <section className="detail-section">
        <div className="detail-section__title">Buyurtma tarixi</div>
        {timeline.isLoading ? (
          <div className="skeleton" style={{ height: 80 }} />
        ) : (
          <ol className="timeline">
            <li className="timeline__item">
              <span className="timeline__time">{timeOf(o.createdAt)} — Buyurtma yaratildi</span>
              <span className="cell-sub">{SOURCE_LABELS[o.source] ?? o.source}</span>
            </li>
            {timeline.data?.map((entry) => (
              <li key={entry.id} className="timeline__item">
                <span className="timeline__time">
                  {timeOf(entry.createdAt)} — {STATUS_LABELS[entry.toStatus] ?? entry.toStatus}
                </span>
                <span className="cell-sub">
                  {entry.userName ?? 'Tizim'}
                  {entry.comment ? ` · ${entry.comment}` : ''}
                </span>
              </li>
            ))}
            {next[0] && (
              <li className="timeline__item timeline__item--muted">
                <span className="muted">Keyingi: {STATUS_LABELS[next[0]] ?? next[0]}</span>
              </li>
            )}
          </ol>
        )}
      </section>
    </SidePanel>
  );
}

/** Couriers ranked by the API (load, then distance); one click assigns. */
function AssignCourier({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const suggestions = useQuery({
    queryKey: ['orders', 'one', orderId, 'courier-suggestions'],
    queryFn: () => api.couriers.suggestions(orderId),
  });
  const assign = useMutation({
    mutationFn: (courierId: string) => api.couriers.assign(orderId, { courierId }),
    onSuccess: onDone,
    onError: (e) => setError(e instanceof RestorApiError ? e.message : 'Biriktirib boʻlmadi'),
  });

  return (
    <section className="detail-section soft-box">
      <div className="detail-section__title">Kuryer tanlang</div>
      {error && <div className="alert alert--error" style={{ margin: 0 }}>{error}</div>}
      {suggestions.isLoading ? (
        <div className="skeleton" style={{ height: 60 }} />
      ) : suggestions.isError ? (
        <ErrorState error={suggestions.error} />
      ) : suggestions.data?.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>Hozir boʻsh kuryer yoʻq</p>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          {suggestions.data?.map((c) => (
            <button
              key={c.id}
              type="button"
              className="menu-item"
              style={{ background: 'var(--surface)' }}
              disabled={assign.isPending}
              onClick={() => assign.mutate(c.id)}
            >
              <span className="avatar avatar--sm">{initialsOf(c.fullName)}</span>
              <span className="menu-item__body">
                <span className="menu-item__title">{c.fullName}</span>
                <span className="menu-item__sub">
                  {COURIER_STATUS_LABELS[c.status] ?? c.status}
                  {c.activeDeliveryCount ? ` · ${c.activeDeliveryCount} ta yetkazmoqda` : ''}
                  {c.distanceM !== undefined ? ` · ${(c.distanceM / 1000).toFixed(1).replace('.', ',')} km` : ''}
                </span>
              </span>
              <span className="pill tone-primary">Biriktirish</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
