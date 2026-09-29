import { useEffect, useMemo, useState } from 'react';
import {
  OrderSource,
  OrderType,
  type BranchMenu,
  type BranchSummary,
  type MenuProduct,
  type Order,
  type OrderPricePreview,
} from '@restor/shared-types';
import { addMoney, formatMoney, multiplyMoney } from '@restor/shared-utils';
import { RestorApiError } from '@restor/api-client';
import { api, tenantSlug } from './api';
import { getWebApp, haptic, isInsideTelegram } from './telegram';

interface Line {
  key: string;
  productId: string;
  name: string;
  variantId: string | null;
  variantName: string | null;
  unitPrice: number;
  quantity: number;
}

type Screen = 'menu' | 'cart' | 'done';

/**
 * Telegram Mini App (TZ §48).
 *
 * Sign-in is the whole Telegram integration: `initData` goes to the backend,
 * which verifies its HMAC before creating or matching the customer. Nothing
 * here decides who the user is.
 */
export function App() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [branch, setBranch] = useState<BranchSummary | null>(null);
  const [menu, setMenu] = useState<BranchMenu | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const [lines, setLines] = useState<Line[]>([]);
  const [screen, setScreen] = useState<Screen>('menu');
  const [orderType, setOrderType] = useState<OrderType>(OrderType.PICKUP);
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [comment, setComment] = useState('');

  const [preview, setPreview] = useState<OrderPricePreview | null>(null);
  const [placed, setPlaced] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /* ------------------------------- auth ------------------------------- */

  useEffect(() => {
    const webApp = getWebApp();

    // Outside Telegram there is no initData to verify. The storefront at
    // customer-web covers that case; here we say so plainly.
    if (!isInsideTelegram() || !webApp) {
      setAuthError('Bu sahifa Telegram ilovasi ichida ochilishi kerak');
      return;
    }

    void api.auth
      .loginWithTelegram({ initData: webApp.initData, tenantSlug })
      .then(() => setIsAuthed(true))
      .catch((caught) =>
        setAuthError(
          caught instanceof RestorApiError ? caught.message : 'Telegram orqali kirish amalga oshmadi',
        ),
      );
  }, []);

  /* ------------------------------- data ------------------------------- */

  useEffect(() => {
    if (!isAuthed) return;
    void api.branches
      .summaries()
      .then((loaded) => {
        setBranches(loaded);
        if (loaded.length >= 1) setBranch(loaded[0]!);
      })
      .catch(() => setError('Filiallar yuklanmadi'));
  }, [isAuthed]);

  useEffect(() => {
    if (!branch) return;
    void api.catalog
      .branchMenu(branch.id)
      .then((loaded) => {
        setMenu(loaded);
        setCategoryId(loaded.categories[0]?.id ?? null);
      })
      .catch(() => setError('Menyu yuklanmadi'));
  }, [branch]);

  /* ------------------------------- cart ------------------------------- */

  function add(product: MenuProduct) {
    haptic('light');

    const variant = product.variants.find((entry) => entry.isDefault) ?? product.variants[0];
    const unitPrice = Math.max(0, product.price + (variant?.priceDelta ?? 0));
    const key = `${product.id}:${variant?.id ?? 'base'}`;

    setLines((current) => {
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
          productId: product.id,
          name: product.name,
          variantId: variant?.id ?? null,
          variantName: variant?.name ?? null,
          unitPrice,
          quantity: 1,
        },
      ];
    });
  }

  function changeQuantity(key: string, delta: number) {
    setLines((current) =>
      current
        .map((line) => (line.key === key ? { ...line, quantity: line.quantity + delta } : line))
        .filter((line) => line.quantity > 0),
    );
  }

  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const estimate = useMemo(
    () => addMoney(...lines.map((line) => multiplyMoney(line.unitPrice, line.quantity))),
    [lines],
  );

  /* ----------------------------- pricing ------------------------------ */

  useEffect(() => {
    if (screen !== 'cart' || !branch || lines.length === 0) return;

    let cancelled = false;

    void api.orders
      .preview({
        branchId: branch.id,
        type: orderType,
        items: lines.map((line) => ({
          productId: line.productId,
          ...(line.variantId ? { variantId: line.variantId } : {}),
          quantity: line.quantity,
          modifierIds: [],
        })),
      })
      .then((result) => !cancelled && setPreview(result))
      .catch(() => !cancelled && setPreview(null));

    return () => {
      cancelled = true;
    };
  }, [screen, branch, lines, orderType]);

  /* ----------------------------- checkout ----------------------------- */

  async function placeOrder() {
    if (!branch) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const order = await api.orders.create({
        branchId: branch.id,
        type: orderType,
        source: OrderSource.TELEGRAM_MINI_APP,
        clientUuid: crypto.randomUUID(),
        items: lines.map((line) => ({
          productId: line.productId,
          ...(line.variantId ? { variantId: line.variantId } : {}),
          quantity: line.quantity,
          modifierIds: [],
        })),
        customer: { phone: phone.trim() },
        ...(orderType === OrderType.DELIVERY
          ? { deliveryAddress: { address: address.trim() } }
          : {}),
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });

      getWebApp()?.HapticFeedback?.notificationOccurred('success');
      setPlaced(order);
      setLines([]);
      setScreen('done');
    } catch (caught) {
      getWebApp()?.HapticFeedback?.notificationOccurred('error');
      setError(caught instanceof RestorApiError ? caught.message : 'Buyurtma yuborilmadi');
    } finally {
      setIsSubmitting(false);
    }
  }

  /* ------------------------------ render ------------------------------ */

  if (authError) {
    return (
      <div className="center">
        <div>
          <p style={{ fontSize: 34, margin: '0 0 10px' }}>🤖</p>
          <p>{authError}</p>
        </div>
      </div>
    );
  }

  if (!isAuthed) return <div className="center">Yuklanmoqda…</div>;

  if (screen === 'done' && placed) {
    return (
      <div className="center">
        <div>
          <p style={{ fontSize: 42, margin: '0 0 10px' }}>✓</p>
          <h1 style={{ fontSize: 19, margin: '0 0 6px', color: 'var(--text)' }}>
            Buyurtma qabul qilindi
          </h1>
          <p style={{ fontSize: 24, fontWeight: 800, color: 'var(--primary)', margin: '0 0 6px' }}>
            {placed.displayNumber}
          </p>
          <p className="muted">{formatMoney(placed.total)}</p>
          <button type="button" className="fallback-btn" onClick={() => setScreen('menu')}>
            Yangi buyurtma
          </button>
        </div>
      </div>
    );
  }

  if (screen === 'cart') {
    const needsAddress = orderType === OrderType.DELIVERY;
    const canSubmit =
      lines.length > 0 &&
      phone.trim().length >= 9 &&
      (!needsAddress || address.trim().length >= 5) &&
      !isSubmitting;

    return (
      <div className="app">
        <div className="head">
          <h1>Savat</h1>
        </div>

        <div className="list">
          {lines.map((line) => (
            <div key={line.key} className="cart-line">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{line.name}</div>
                {line.variantName && <div className="muted" style={{ fontSize: 12 }}>{line.variantName}</div>}
                <div className="muted" style={{ fontSize: 12 }}>{formatMoney(line.unitPrice)}</div>
              </div>
              <div className="qty">
                <button type="button" onClick={() => changeQuantity(line.key, -1)} aria-label="−">
                  −
                </button>
                <strong style={{ minWidth: 16, textAlign: 'center' }}>{line.quantity}</strong>
                <button type="button" onClick={() => changeQuantity(line.key, 1)} aria-label="+">
                  +
                </button>
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 7, margin: '14px 0' }}>
            {[
              { value: OrderType.PICKUP, label: 'Olib ketish' },
              { value: OrderType.DELIVERY, label: 'Yetkazish' },
            ].map((entry) => (
              <button
                key={entry.value}
                type="button"
                className={`chip${orderType === entry.value ? ' chip--active' : ''}`}
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => setOrderType(entry.value)}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div className="field">
            <label htmlFor="t-phone">Telefon *</label>
            <input
              id="t-phone"
              type="tel"
              inputMode="tel"
              placeholder="+998 90 123 45 67"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>

          {needsAddress && (
            <div className="field">
              <label htmlFor="t-address">Manzil *</label>
              <input
                id="t-address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="t-comment">Izoh</label>
            <textarea
              id="t-comment"
              rows={2}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </div>

          {error && <div className="alert alert--error">{error}</div>}

          {preview && (
            <div className="totals">
              <div className="totals__row">
                <span className="muted">Mahsulotlar</span>
                <span>{formatMoney(preview.subtotal)}</span>
              </div>
              {preview.discountTotal > 0 && (
                <div className="totals__row">
                  <span className="muted">Chegirma</span>
                  <span>−{formatMoney(preview.discountTotal)}</span>
                </div>
              )}
              {preview.deliveryFee > 0 && (
                <div className="totals__row">
                  <span className="muted">Yetkazish</span>
                  <span>{formatMoney(preview.deliveryFee)}</span>
                </div>
              )}
              <div className="totals__row totals__row--grand">
                <span>Jami</span>
                <span>{formatMoney(preview.total)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="bar">
          <button
            type="button"
            className="fallback-btn"
            style={{ marginTop: 0 }}
            disabled={!canSubmit}
            onClick={() => void placeOrder()}
          >
            {isSubmitting ? 'Yuborilmoqda…' : `Buyurtma berish · ${formatMoney(preview?.total ?? estimate)}`}
          </button>
          <button
            type="button"
            className="chip"
            style={{ width: '100%', marginTop: 8, justifyContent: 'center' }}
            onClick={() => setScreen('menu')}
          >
            Menyuga qaytish
          </button>
        </div>
      </div>
    );
  }

  const category = menu?.categories.find((entry) => entry.id === categoryId);

  return (
    <div className="app">
      <div className="head">
        <h1>{branch?.name ?? 'Menyu'}</h1>
        {branch && <p>{branch.address}</p>}
      </div>

      {branches.length > 1 && (
        <div className="chips">
          {branches.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`chip${entry.id === branch?.id ? ' chip--active' : ''}`}
              onClick={() => setBranch(entry)}
            >
              {entry.name}
            </button>
          ))}
        </div>
      )}

      {menu && (
        <div className="chips">
          {menu.categories.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`chip${entry.id === categoryId ? ' chip--active' : ''}`}
              onClick={() => setCategoryId(entry.id)}
            >
              {entry.name}
            </button>
          ))}
        </div>
      )}

      <div className="list">
        {!menu && <p className="muted">Menyu yuklanmoqda…</p>}

        {category?.products.map((product) => (
          <button key={product.id} type="button" className="item" onClick={() => add(product)}>
            <div className="item__body">
              <p className="item__name">{product.name}</p>
              {product.description && <p className="item__desc">{product.description}</p>}
              <span className="item__price">
                {formatMoney(product.price)}
                {product.oldPrice && (
                  <span className="item__old">{formatMoney(product.oldPrice)}</span>
                )}
              </span>
            </div>
            <span className="item__add" aria-hidden="true">+</span>
          </button>
        ))}
      </div>

      {count > 0 && (
        <div className="bar">
          <button
            type="button"
            className="fallback-btn"
            style={{ marginTop: 0 }}
            onClick={() => setScreen('cart')}
          >
            Savat · {count} · {formatMoney(estimate)}
          </button>
        </div>
      )}
    </div>
  );
}
