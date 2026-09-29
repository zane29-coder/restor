import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  OrderSource,
  OrderType,
  PaymentMethod,
  type BranchMenu,
  type BranchSummary,
  type CreateOrderRequest,
  type MenuProduct,
} from '@restor/shared-types';
import { addMoney, formatMoney, multiplyMoney } from '@restor/shared-utils';
import { RestorApiError } from '@restor/api-client';
import { api, loadBranchId, saveBranchId } from './api';
import { enqueue, flushQueue, queueSize } from './offline-queue';
import { LoginScreen } from './LoginScreen';

interface CartLine {
  key: string;
  product: MenuProduct;
  variantId: string | null;
  variantName: string | null;
  unitPrice: number;
  quantity: number;
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

  async function checkout(method: PaymentMethod) {
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
      paymentMethod: method,
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
      setMessage(`Buyurtma ${order.displayNumber} qabul qilindi · ${formatMoney(order.total)}`);
      setCart([]);
    } catch (caught) {
      if (caught instanceof RestorApiError && caught.isNetworkFailure) {
        // Offline: keep selling. The queue replays when the link returns.
        enqueue(payload);
        setPending(queueSize());
        setMessage('Internet yoʻq — buyurtma navbatga qoʻyildi');
        setCart([]);
      } else {
        setError(
          caught instanceof RestorApiError ? caught.message : 'Buyurtma yaratilmadi',
        );
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

  const category = menu?.categories.find((entry) => entry.id === categoryId);

  return (
    <div className="pos">
      <header className="pos__header">
        <div className="pos__brand">
          RES<span>TOR</span> POS
        </div>
        <span className="pos__chip">
          {branches.find((branch) => branch.id === branchId)?.name ?? '—'}
        </span>
        <div className="pos__spacer" />
        {/* The cashier has to know instantly whether a sale reached the server. */}
        <span
          className="pos__chip"
          style={{ background: isOnline ? 'rgb(22 163 74 / 35%)' : 'rgb(220 38 38 / 40%)' }}
        >
          {isOnline ? '● Onlayn' : '● Oflayn'}
        </span>
        {pending > 0 && <span className="pos__chip">Navbatda: {pending}</span>}
        <button
          type="button"
          className="pos__chip"
          style={{ border: 'none', color: '#fff' }}
          onClick={() => void api.auth.logout().then(() => setIsAuthenticated(false))}
        >
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
                      −
                    </button>
                    <strong style={{ minWidth: 20, textAlign: 'center' }}>{line.quantity}</strong>
                    <button
                      type="button"
                      className="qty-btn"
                      onClick={() => changeQuantity(line.key, 1)}
                      aria-label="Koʻpaytirish"
                    >
                      +
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
                className="pay-btn pay-btn--primary"
                disabled={cart.length === 0 || isSubmitting}
                onClick={() => void checkout(PaymentMethod.CASH)}
              >
                NAQD
              </button>
              <button
                type="button"
                className="pay-btn"
                disabled={cart.length === 0 || isSubmitting}
                onClick={() => void checkout(PaymentMethod.CARD)}
              >
                KARTA
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
    </div>
  );
}
