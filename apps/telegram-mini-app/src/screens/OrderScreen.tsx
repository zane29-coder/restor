import { useCallback, useEffect, useState } from 'react';
import {
  OrderStatus,
  OrderType,
  PaymentStatus,
  TERMINAL_ORDER_STATUSES,
  type MyOrderDetail,
} from '@restor/shared-types';
import { IconAlert, IconCheckCircle, IconClock } from '@restor/ui';
import { api } from '../api';
import { useToast } from '../components/Toast';
import { ErrorState, ListSkeleton, ScreenHeader } from '../components/ui';
import { errorMessage } from '../lib/errors';
import {
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  PAYMENT_STATUS_LABELS,
  clock,
  dateTime,
  paymentLabel,
  som,
  statusTone,
} from '../lib/format';
import { onActivated, openExternal } from '../telegram';

/** How often an order in progress is re-read while the screen is open. */
const POLL_MS = 15_000;

/** The steps a customer sees, in order, for the progress line. */
const STEPS_DELIVERY: OrderStatus[] = [
  OrderStatus.NEW,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.ON_DELIVERY,
  OrderStatus.DELIVERED,
];
const STEPS_PICKUP: OrderStatus[] = [
  OrderStatus.NEW,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.DELIVERED,
];

/** Where a status sits on that line; courier hand-offs count as "ready". */
function stepIndex(status: OrderStatus, steps: OrderStatus[]): number {
  if (status === OrderStatus.WAITING_COURIER || status === OrderStatus.COURIER_ASSIGNED) {
    return steps.indexOf(OrderStatus.READY);
  }
  return steps.indexOf(status);
}

/**
 * One order (TZ 48 §15, §22.3, §24): its progress, what was in it, how it is
 * being paid — and, for an online order still owed, the way to pay.
 *
 * "Paid" is shown only when the server says so. The server learns it from
 * Subo's API (webhook or the "check" button below), never from the customer
 * having come back from the payment page.
 */
export function OrderScreen({
  id,
  justPlaced,
  active,
}: {
  id: string;
  justPlaced?: boolean;
  active: boolean;
}) {
  const toast = useToast();
  const [detail, setDetail] = useState<MyOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'pay' | 'check' | null>(null);

  const load = useCallback(() => {
    api.me
      .order(id)
      .then((result) => {
        setDetail(result);
        setError(null);
      })
      .catch((caught) => setError(errorMessage(caught, 'Buyurtma yuklanmadi')));
  }, [id]);

  useEffect(() => {
    if (!active) return;
    load();
  }, [active, load]);

  // Keep an order in progress fresh while it is on screen, and re-check the
  // moment the customer comes back from the payment page.
  const settled =
    detail !== null &&
    (TERMINAL_ORDER_STATUSES as readonly string[]).includes(detail.order.status) &&
    detail.order.paymentStatus !== PaymentStatus.UNPAID;
  useEffect(() => {
    if (!active || settled) return;
    const timer = window.setInterval(load, POLL_MS);
    const stop = onActivated(load);
    return () => {
      window.clearInterval(timer);
      stop();
    };
  }, [active, settled, load]);

  async function pay() {
    if (!detail) return;
    setBusy('pay');
    try {
      const link = await api.me.retryPayment(detail.order.id);
      openExternal(link.checkoutUrl);
    } catch (caught) {
      toast.show(errorMessage(caught), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function check() {
    setBusy('check');
    try {
      const result = await api.me.refreshPayment(id);
      setDetail(result);
      if (result.order.paymentStatus === PaymentStatus.PAID) toast.show('Toʻlov tasdiqlandi', 'success');
      else toast.show('Toʻlov hali tasdiqlanmagan', 'info');
    } catch (caught) {
      toast.show(errorMessage(caught), 'error');
    } finally {
      setBusy(null);
    }
  }

  if (error && !detail) {
    return (
      <div className="screen">
        <ScreenHeader title="Buyurtma" />
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="screen">
        <ScreenHeader title="Buyurtma" />
        <ListSkeleton rows={5} />
      </div>
    );
  }

  const { order } = detail;
  const steps = order.type === OrderType.DELIVERY ? STEPS_DELIVERY : STEPS_PICKUP;
  const current = stepIndex(order.status, steps);
  const cancelled = order.status === OrderStatus.CANCELLED || order.status === OrderStatus.REFUNDED;
  const awaitingPayment = detail.canRetryPayment;

  return (
    <div className="screen">
      <ScreenHeader title={`Buyurtma ${order.displayNumber}`} subtitle={detail.restaurantName} />

      {justPlaced && (
        <div className={`result-banner${awaitingPayment ? ' result-banner--wait' : ''}`}>
          {awaitingPayment ? <IconClock size={32} /> : <IconCheckCircle size={32} />}
          <div>
            <p className="result-banner__title">
              {awaitingPayment ? 'Toʻlov kutilmoqda' : 'Buyurtma yuborildi'}
            </p>
            <p className="result-banner__text">
              {awaitingPayment
                ? 'Buyurtma yaratildi. Toʻlov tasdiqlangach restoran uni tayyorlashni boshlaydi.'
                : 'Restoran buyurtmani tasdiqlashi bilan sizga xabar beramiz.'}
            </p>
          </div>
        </div>
      )}

      {awaitingPayment && (
        <section className="card-block">
          <div className="notice notice--warn">
            <IconAlert size={18} />
            <span>Onlayn toʻlov hali tasdiqlanmagan.</span>
          </div>
          <div className="button-row">
            <button type="button" className="btn btn--primary btn--grow" disabled={busy !== null} onClick={() => void pay()}>
              {busy === 'pay' ? 'Ochilmoqda…' : `Toʻlash · ${som(order.total - order.paidTotal)}`}
            </button>
            <button type="button" className="btn btn--secondary" disabled={busy !== null} onClick={() => void check()}>
              {busy === 'check' ? 'Tekshirilmoqda…' : 'Tekshirish'}
            </button>
          </div>
          <p className="hint">Qayta toʻlash yangi buyurtma yaratmaydi — xuddi shu buyurtma uchun toʻlanadi.</p>
        </section>
      )}

      <section className="card-block">
        <div className="status-head">
          <span className={`chip chip--${statusTone(order.status)}`}>{ORDER_STATUS_LABELS[order.status]}</span>
          <span className="muted">{dateTime(order.createdAt)}</span>
        </div>

        {!cancelled && (
          <ol className="progress" aria-label="Buyurtma holati">
            {steps.map((step, index) => (
              <li
                key={step}
                className={`progress__step${index <= current ? ' progress__step--done' : ''}${
                  index === current ? ' progress__step--current' : ''
                }`}
              >
                <span className="progress__dot" aria-hidden="true" />
                <span className="progress__label">{ORDER_STATUS_LABELS[step]}</span>
              </li>
            ))}
          </ol>
        )}

        {cancelled && order.cancelReason && (
          <p className="notice notice--error">Sabab: {order.cancelReason}</p>
        )}
        {order.estimatedReadyAt && !cancelled && order.status !== OrderStatus.DELIVERED && (
          <p className="hint">Taxminan {clock(order.estimatedReadyAt)} da tayyor boʻladi</p>
        )}
      </section>

      <section className="card-block">
        <h2 className="block-title">Tarkibi</h2>
        <ul className="order-items">
          {order.items.map((item) => (
            <li key={item.id}>
              <span className="order-items__qty">{item.quantity}×</span>
              <span className="order-items__name">
                {item.name}
                {item.variantName && <span className="muted"> ({item.variantName})</span>}
                {item.modifiers.length > 0 && (
                  <span className="order-items__mods">{item.modifiers.map((m) => m.name).join(', ')}</span>
                )}
              </span>
              <span className="order-items__sum">{som(item.total)}</span>
            </li>
          ))}
        </ul>

        <dl className="breakdown">
          <div>
            <dt>Mahsulotlar</dt>
            <dd>{som(order.subtotal)}</dd>
          </div>
          {order.discountTotal > 0 && (
            <div className="breakdown__discount">
              <dt>Chegirma</dt>
              <dd>−{som(order.discountTotal)}</dd>
            </div>
          )}
          {order.type === OrderType.DELIVERY && (
            <div>
              <dt>Yetkazib berish</dt>
              <dd>{order.deliveryFee === 0 ? 'Bepul' : som(order.deliveryFee)}</dd>
            </div>
          )}
          {order.serviceFee > 0 && (
            <div>
              <dt>Xizmat yigʻimi</dt>
              <dd>{som(order.serviceFee)}</dd>
            </div>
          )}
          <div className="breakdown__total">
            <dt>Jami</dt>
            <dd>{som(order.total)}</dd>
          </div>
        </dl>
      </section>

      <section className="card-block">
        <dl className="kv">
          <div>
            <dt>Turi</dt>
            <dd>{ORDER_TYPE_LABELS[order.type] ?? order.type}</dd>
          </div>
          <div>
            <dt>Toʻlov</dt>
            <dd>{paymentLabel(order.paymentMethod, order.paymentProvider)}</dd>
          </div>
          <div>
            <dt>Toʻlov holati</dt>
            <dd>{PAYMENT_STATUS_LABELS[order.paymentStatus]}</dd>
          </div>
          {order.branch && (
            <div>
              <dt>Filial</dt>
              <dd>{order.branch.name}</dd>
            </div>
          )}
          {order.deliveryAddress && (
            <div>
              <dt>Manzil</dt>
              <dd>
                {[
                  order.deliveryAddress.address,
                  order.deliveryAddress.apartment && `${order.deliveryAddress.apartment}-xonadon`,
                  order.deliveryAddress.entrance && `${order.deliveryAddress.entrance}-podyezd`,
                  order.deliveryAddress.floor && `${order.deliveryAddress.floor}-qavat`,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </dd>
            </div>
          )}
          {order.comment && (
            <div>
              <dt>Restoranga izoh</dt>
              <dd>{order.comment}</dd>
            </div>
          )}
          {order.courierComment && (
            <div>
              <dt>Kuryerga izoh</dt>
              <dd>{order.courierComment}</dd>
            </div>
          )}
          {order.cutleryCount != null && (
            <div>
              <dt>Anjomlar</dt>
              <dd>{order.cutleryCount === 0 ? 'Kerak emas' : `${order.cutleryCount} ta`}</dd>
            </div>
          )}
          {order.leaveAtDoor && (
            <div>
              <dt>Yetkazish</dt>
              <dd>Eshik oldida qoldirish</dd>
            </div>
          )}
        </dl>
      </section>
    </div>
  );
}
