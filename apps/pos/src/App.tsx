import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  OrderSource,
  OrderType,
  PaymentMethod,
  type BranchMenu,
  type BranchSummary,
  type CashShift,
  type CreateOrderRequest,
  type MenuProduct,
  type Order,
} from '@restor/shared-types';
import { addMoney, formatMoney, multiplyMoney } from '@restor/shared-utils';
import { RestorApiError } from '@restor/api-client';
import { IconDot, IconLogout, IconMinus, IconPlus } from '@restor/ui';
import { api, loadBranchId, saveBranchId } from './api';
import { enqueue, flushQueue, queueSize, settle } from './offline-queue';
import { LoginScreen } from './LoginScreen';
import { PaymentDialog, type TenderPart } from './PaymentDialog';
import { CloseShiftDialog, OpenShiftScreen } from './ShiftPanel';
import { Receipt } from './Receipt';

interface CartLine {
  key: string;
  product: MenuProduct;
  variantId: string | null;
  variantName: string | null;
  unitPrice: number;
  quantity: number;
}

/**
 * Fits the chosen tenders to the total the SERVER priced.
 *
 * The till's estimate can differ from the server's price — a promotion the
 * till had not loaded, a price edited minutes ago — and a payment that does
 * not match what is owed leaves the order PARTIALLY_PAID with nobody told.
 *
 * A single tender simply becomes the total. A mixed one keeps the cash part
 * the cashier counted, capped at the total, and the remainder goes on the
 * card: the cash is the half that already physically changed hands.
 */
function scaleToTotal(parts: TenderPart[], total: number): TenderPart[] {
  if (parts.length <= 1) {
    return [{ method: parts[0]?.method ?? PaymentMethod.CASH, amount: total }];
  }

  const cash = parts.find((part) => part.method === PaymentMethod.CASH);
  const cashAmount = Math.min(cash?.amount ?? 0, total);
  const rest = total - cashAmount;

  return [
    ...(cashAmount > 0 ? [{ method: PaymentMethod.CASH, amount: cashAmount }] : []),
    ...(rest > 0
      ? [
          {
            method:
              parts.find((part) => part.method !== PaymentMethod.CASH)?.method ??
              PaymentMethod.CARD,
            amount: rest,
          },
        ]
      : []),
  ];
}

const ORDER_TYPES: Array<{ value: OrderType; label: string }> = [
  { value: OrderType.DINE_IN, label: 'Zalda' },
  { value: OrderType.PICKUP, label: 'Olib ketish' },
  { value: OrderType.DELIVERY, label: 'Yetkazish' },
];

export function App() {
  const [isReady, setIsReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [branchId, setBranchId] = useState<string | null>(loadBranchId());
  const [menu, setMenu] = useState<BranchMenu | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>(OrderType.DINE_IN);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [pending, setPending] = useState(queueSize());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /* ------------------------------ till state ------------------------- */

  const [shift, setShift] = useState<CashShift | null>(null);
  const [isShiftLoading, setIsShiftLoading] = useState(true);
  const [isPaying, setIsPaying] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [receipt, setReceipt] = useState<{
    order: Order;
    parts: TenderPart[];
    change: number;
  } | null>(null);

  /* ----------------------------- session ----------------------------- */

  useEffect(() => {
    void (async () => {
      try {
        if (await api.http.isAuthenticated()) {
          await api.auth.me();
          setIsAuthenticated(true);
        }
      } catch {
        await api.http.clearTokens();
      } finally {
        setIsReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    void api.branches.summaries().then(setBranches).catch(() => setBranches([]));
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !branchId) return;
    void api.catalog
      .branchMenu(branchId)
      .then((loaded) => {
        setMenu(loaded);
        setCategoryId(loaded.categories[0]?.id ?? null);
      })
      .catch((caught) =>
        setError(caught instanceof RestorApiError ? caught.message : 'Menyu yuklanmadi'),
      );
  }, [isAuthenticated, branchId]);

  /**
   * The shift this till is selling into.
   *
   * Looked up per branch rather than per terminal: a cashier who moves to the
   * second till mid-service is still working the same shift, and handing them
   * a second one would split the day's takings in two.
   */
  useEffect(() => {
    if (!isAuthenticated || !branchId) return;
    setIsShiftLoading(true);
    void api.cash
      .currentShift(branchId)
      .then(setShift)
      .catch(() => setShift(null))
      .finally(() => setIsShiftLoading(false));
  }, [isAuthenticated, branchId]);

  /* --------------------------- offline sync --------------------------- */

  const sync = useCallback(async () => {
    const result = await flushQueue();
    setPending(result.remaining);
    if (result.sent > 0) {
      setMessage(`${result.sent} ta navbatdagi buyurtma yuborildi`);
    }
    if (result.failed > 0) {
      setError(`${result.failed} ta buyurtma server tomonidan rad etildi`);
    }
  }, []);

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      void sync();
    };
    const goOffline = () => setIsOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    // Also sweep periodically: `online` can fire while the API is still
    // unreachable, and a captive-portal style outage never fires it at all.
    const timer = setInterval(() => {
      if (navigator.onLine && queueSize() > 0) void sync();
    }, 30_000);

    if (navigator.onLine && queueSize() > 0) void sync();

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearInterval(timer);
    };
  }, [sync]);

  /* ------------------------------- cart ------------------------------- */

  function addToCart(product: MenuProduct) {
    // Default to the variant marked default, or the first one.
    const variant = product.variants.find((entry) => entry.isDefault) ?? product.variants[0];
    const unitPrice = Math.max(0, product.price + (variant?.priceDelta ?? 0));
    const key = `${product.id}:${variant?.id ?? 'base'}`;

    setCart((current) => {
      const existing = current.find((line) => line.key === key);
      if (existing) {
        return current.map((line) =>
          line.key === key ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [
        ...current,
        {
          key,
          product,
          variantId: variant?.id ?? null,
          variantName: variant?.name ?? null,
          unitPrice,
          quantity: 1,
        },
      ];
    });
  }

  function changeQuantity(key: string, delta: number) {
    setCart((current) =>
      current
        .map((line) => (line.key === key ? { ...line, quantity: line.quantity + delta } : line))
        .filter((line) => line.quantity > 0),
    );
  }

  const subtotal = useMemo(
    () => addMoney(...cart.map((line) => multiplyMoney(line.unitPrice, line.quantity))),
    [cart],
  );

  /* ------------------------------ checkout ---------------------------- */

  /**
   * Creates the order, then settles it with the tender taken at the counter.
   *
   * Two steps rather than one, because the server prices the order itself
   * (TZ §76) — what the customer owes is not known until it comes back. The
   * payment is then recorded against that authoritative total, never against
   * the cashier's local estimate.
   */
  async function checkout(parts: TenderPart[], tendered: number) {
    if (!branchId || cart.length === 0) return;

    setIsSubmitting(true);
    setError(null);
    setMessage(null);

    // Generated BEFORE the request so a retry — online or from the queue —
    // carries the same key and cannot create a duplicate order (TZ §18).
    const clientUuid = crypto.randomUUID();

    const payload: CreateOrderRequest & { clientUuid: string } = {
      branchId,
      type: orderType,
      source: OrderSource.POS,
      clientUuid,
      paymentMethod: parts[0]?.method ?? PaymentMethod.CASH,
      items: cart.map((line) => ({
        productId: line.product.id,
        ...(line.variantId ? { variantId: line.variantId } : {}),
        quantity: line.quantity,
        modifierIds: [],
      })),
      // Dine-in needs no customer; delivery would collect one on a later screen.
      ...(orderType === OrderType.DINE_IN ? {} : { customer: {} }),
    };

    try {
      const order = await api.orders.create(payload);

      // Re-scaled to the server's total. The cashier's estimate and the
      // server's price can differ — a promotion the till did not know about,
      // a price changed minutes ago — and the payment must match what is
      // actually owed, or the order lands PARTIALLY_PAID with nobody warned.
      const settled = scaleToTotal(parts, order.total);
      await settle(order.id, { parts: settled });

      setCart([]);
      setReceipt({
        order,
        parts: settled,
        change: Math.max(0, tendered - order.total),
      });
    } catch (caught) {
      if (caught instanceof RestorApiError && caught.isNetworkFailure) {
        // Offline: keep selling. The queue replays the order AND its payment
        // when the link returns.
        enqueue(payload, { parts });
        setPending(queueSize());
        setMessage('Internet yoʻq — buyurtma va toʻlov navbatga qoʻyildi');
        setCart([]);
        setIsPaying(false);
      } else {
        setError(caught instanceof RestorApiError ? caught.message : 'Buyurtma yaratilmadi');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  /* ------------------------------ render ------------------------------ */

  if (!isReady) {
    return <div className="pos__center">Yuklanmoqda…</div>;
  }

  if (!isAuthenticated) {
    return <LoginScreen onSuccess={() => setIsAuthenticated(true)} />;
  }

  if (!branchId) {
    return (
      <div className="pos__center">
        <div className="login-box">
          <h1>Filialni tanlang</h1>
          <select
            defaultValue=""
            onChange={(event) => {
              if (!event.target.value) return;
              saveBranchId(event.target.value);
              setBranchId(event.target.value);
            }}
          >
            <option value="" disabled>
              — tanlang —
            </option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  const branchName = branches.find((branch) => branch.id === branchId)?.name ?? '—';

  if (isShiftLoading) {
    return <div className="pos__center">Smena tekshirilmoqda…</div>;
  }

  /*
    The till is gated behind an open shift. Selling without one would put cash
    in a drawer nobody is accountable for, which is the single thing a shift
    exists to prevent (TZ §19).
  */
  if (!shift) {
    return (
      <OpenShiftScreen
        branchId={branchId}
        branchName={branchName}
        onOpened={(opened) => {
          setShift(opened);
          setMessage('Smena ochildi');
        }}
      />
    );
  }

  const category = menu?.categories.find((entry) => entry.id === categoryId);

  return (
    <div className="pos">
      <header className="pos__header">
        <div className="pos__brand">
          RES<span>TOR</span> POS
        </div>
        <span className="pos__chip">{branchName}</span>
        <button
          type="button"
          className="pos__chip pos__chip--status"
          style={{ border: 'none', color: '#fff' }}
          onClick={() => setIsClosing(true)}
          title="Smenani yopish"
        >
          Kassada: {formatMoney(shift.expectedCash, 'UZS', { withCurrency: false })}
        </button>
        <div className="pos__spacer" />
        {/* The cashier has to know instantly whether a sale reached the server. */}
        <span
          className="pos__chip pos__chip--status"
          style={{ background: isOnline ? 'rgb(22 163 74 / 35%)' : 'rgb(220 38 38 / 40%)' }}
        >
          <IconDot size={9} style={{ color: isOnline ? '#4ade80' : '#f87171' }} />
          {isOnline ? 'Onlayn' : 'Oflayn'}
        </span>
        {pending > 0 && <span className="pos__chip">Navbatda: {pending}</span>}
        <button
          type="button"
          className="pos__chip pos__chip--status"
          style={{ border: 'none', color: '#fff' }}
          onClick={() => void api.auth.logout().then(() => setIsAuthenticated(false))}
        >
          <IconLogout size={15} />
          Chiqish
        </button>
      </header>

      {error && <div className="pos__error">{error}</div>}
      {message && <div className="pos__banner">{message}</div>}

      <div className="pos__body">
        <section className="menu">
          <div className="menu__tabs">
            {menu?.categories.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`menu__tab${entry.id === categoryId ? ' menu__tab--active' : ''}`}
                onClick={() => setCategoryId(entry.id)}
              >
                {entry.name}
              </button>
            ))}
          </div>

          <div className="menu__grid">
            {category?.products.map((product) => (
              <button
                key={product.id}
                type="button"
                className="product"
                onClick={() => addToCart(product)}
              >
                <span className="product__name">{product.name}</span>
                <span className="product__price">
                  {formatMoney(product.price, 'UZS', { withCurrency: false })}
                  {product.oldPrice && (
                    <span className="product__old">
                      {' '}
                      {formatMoney(product.oldPrice, 'UZS', { withCurrency: false })}
                    </span>
                  )}
                </span>
              </button>
            ))}
            {!menu && <p className="empty">Menyu yuklanmoqda…</p>}
          </div>
        </section>

        <aside className="cart">
          <div className="cart__head">
            {ORDER_TYPES.map((entry) => (
              <button
                key={entry.value}
                type="button"
                className={`cart__type${orderType === entry.value ? ' cart__type--active' : ''}`}
                onClick={() => setOrderType(entry.value)}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div className="cart__items">
            {cart.length === 0 ? (
              <p className="empty">Savat boʻsh</p>
            ) : (
              cart.map((line) => (
                <div key={line.key} className="cart__line">
                  <div>
                    <div className="cart__name">{line.product.name}</div>
                    {line.variantName && <div className="cart__meta">{line.variantName}</div>}
                    <div className="cart__meta">
                      {formatMoney(line.unitPrice)} ×{line.quantity}
                    </div>
                  </div>
                  <div className="cart__qty">
                    <button
                      type="button"
                      className="qty-btn"
                      onClick={() => changeQuantity(line.key, -1)}
                      aria-label="Kamaytirish"
                    >
                      <IconMinus size={17} strokeWidth={2.25} />
                    </button>
                    <strong style={{ minWidth: 20, textAlign: 'center' }}>{line.quantity}</strong>
                    <button
                      type="button"
                      className="qty-btn"
                      onClick={() => changeQuantity(line.key, 1)}
                      aria-label="Koʻpaytirish"
                    >
                      <IconPlus size={17} strokeWidth={2.25} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="cart__foot">
            {/*
              A local estimate for the cashier's eye only. The authoritative
              total comes back from the server, which re-prices everything.
            */}
            <div className="cart__total-line">
              <span className="cart__meta">Taxminiy summa</span>
              <span>{formatMoney(subtotal)}</span>
            </div>
            <div className="cart__grand">
              <span>Jami</span>
              <span>{formatMoney(subtotal)}</span>
            </div>

            <div className="pay-grid">
              <button
                type="button"
                className="pay-btn pay-btn--primary pay-btn--wide"
                disabled={cart.length === 0 || isSubmitting}
                onClick={() => setIsPaying(true)}
              >
                TOʻLOVGA OʻTISH
              </button>
              <button
                type="button"
                className="pay-btn pay-btn--wide"
                style={{ background: '#6b7280' }}
                disabled={cart.length === 0 || isSubmitting}
                onClick={() => setCart([])}
              >
                TOZALASH
              </button>
            </div>
          </div>
        </aside>
      </div>

      {isPaying && (
        <PaymentDialog
          total={subtotal}
          isSubmitting={isSubmitting}
          onCancel={() => setIsPaying(false)}
          onConfirm={(parts, tendered) => {
            void checkout(parts, tendered).then(() => setIsPaying(false));
          }}
        />
      )}

      {receipt && (
        <Receipt
          order={receipt.order}
          parts={receipt.parts}
          change={receipt.change}
          branchName={branchName}
          onDismiss={() => {
            setReceipt(null);
            // The drawer moved, so the header figure has to follow.
            void api.cash.currentShift(branchId).then(setShift).catch(() => undefined);
          }}
        />
      )}

      {isClosing && (
        <CloseShiftDialog
          shift={shift}
          onClose={() => setIsClosing(false)}
          onClosed={(text) => {
            setIsClosing(false);
            setShift(null);
            setMessage(text);
          }}
        />
      )}
    </div>
  );
}
