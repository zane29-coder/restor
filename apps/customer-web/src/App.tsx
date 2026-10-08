import { useEffect, useState } from 'react';
import { ErrorCode } from '@restor/shared-types';
import type { BranchMenu, BranchSummary, Order } from '@restor/shared-types';
import { formatMoney } from '@restor/shared-utils';
import { RestorApiError } from '@restor/api-client';
import { IconCheckCircle, IconPlus } from '@restor/ui';
import { api } from './api';
import { useCart } from './useCart';
import { CheckoutSheet } from './CheckoutSheet';

/**
 * Customer storefront (TZ §11).
 *
 *   branch → menu → cart → delivery/pickup → checkout → confirmation
 *
 * Every price the customer confirms comes from `/orders/preview`, so what is
 * shown and what is charged cannot diverge.
 */
export function App() {
  const [branches, setBranches] = useState<BranchSummary[] | null>(null);
  const [branch, setBranch] = useState<BranchSummary | null>(null);
  const [menu, setMenu] = useState<BranchMenu | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [placedOrder, setPlacedOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Kept beside the message because one failure is not a failure at all: at the
  // platform's own address no restaurant has been named yet, and that gets a
  // page of its own rather than a red alert.
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const cart = useCart();

  useEffect(() => {
    void api.branches
      .summaries()
      .then((loaded) => {
        setBranches(loaded);
        // One branch is the common case; skip the picker entirely.
        if (loaded.length === 1) setBranch(loaded[0]!);
      })
      .catch((caught) => {
        if (caught instanceof RestorApiError) {
          setErrorCode(caught.code);
          setError(caught.message);
        } else {
          setError('Restoran maʼlumotlari yuklanmadi');
        }
      });
  }, []);

  useEffect(() => {
    if (!branch) return;
    void api.catalog
      .branchMenu(branch.id)
      .then((loaded) => {
        setMenu(loaded);
        setCategoryId(loaded.categories[0]?.id ?? null);
      })
      .catch((caught) =>
        setError(caught instanceof RestorApiError ? caught.message : 'Menyu yuklanmadi'),
      );
  }, [branch]);

  /* ------------------------------ states ------------------------------ */

  if (placedOrder) {
    return <OrderPlaced order={placedOrder} onDone={() => {
      setPlacedOrder(null);
      cart.clear();
    }} />;
  }

  // Nothing named a restaurant. Expected at the platform's bare domain, so it
  // is explained rather than reported as an error — and "Qayta urinish" would
  // be useless advice, because retrying cannot name one.
  if (errorCode === ErrorCode.TENANT_NOT_SPECIFIED) {
    return <NoRestaurantChosen />;
  }

  if (error && !branches) {
    return (
      <div className="center">
        <div>
          <div className="alert alert--error">{error}</div>
          <button type="button" className="btn btn--ghost" onClick={() => window.location.reload()}>
            Qayta urinish
          </button>
        </div>
      </div>
    );
  }

  if (!branches) {
    return <div className="center">Yuklanmoqda…</div>;
  }

  if (!branch) {
    return (
      <div className="shell">
        <header className="header">
          <h1 className="header__title">Filialni tanlang</h1>
        </header>
        <div className="section">
          {branches.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="branch-card"
              onClick={() => setBranch(entry)}
            >
              <p className="branch-card__name">{entry.name}</p>
              <p className="muted" style={{ margin: '0 0 8px', fontSize: 13 }}>{entry.address}</p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span
                  className="badge"
                  style={{
                    background: entry.isOpenNow ? '#DCFCE7' : '#FEE2E2',
                    color: entry.isOpenNow ? '#166534' : '#991B1B',
                  }}
                >
                  {entry.isOpenNow ? 'Ochiq' : 'Yopiq'}
                </span>
                {entry.distanceM !== undefined && (
                  <span className="muted" style={{ fontSize: 13 }}>
                    {(entry.distanceM / 1000).toFixed(1)} km
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const category = menu?.categories.find((entry) => entry.id === categoryId);

  return (
    <div className="shell">
      <header className="header">
        <div className="header__row">
          <div style={{ flex: 1 }}>
            <h1 className="header__title">{branch.name}</h1>
            <p className="header__branch">{branch.address}</p>
          </div>
          {branches.length > 1 && (
            <button
              type="button"
              className="chip"
              onClick={() => {
                setBranch(null);
                setMenu(null);
                cart.clear();
              }}
            >
              Oʻzgartirish
            </button>
          )}
        </div>
      </header>

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

      <div className="section">
        {!menu && <p className="muted">Menyu yuklanmoqda…</p>}

        {category && (
          <>
            <h2 className="section__title">{category.name}</h2>
            {category.products.map((product) => (
              <button
                key={product.id}
                type="button"
                className="product"
                onClick={() => cart.add(product)}
              >
                <div className="product__body">
                  <p className="product__name">{product.name}</p>
                  {product.description && <p className="product__desc">{product.description}</p>}
                  <span className="product__price">
                    {formatMoney(product.price)}
                    {product.oldPrice && (
                      <span className="product__old">{formatMoney(product.oldPrice)}</span>
                    )}
                  </span>
                  {product.variants.length > 1 && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                      {product.variants.length} ta oʻlcham
                    </div>
                  )}
                </div>
                <span className="product__add">
                  <IconPlus size={20} strokeWidth={2.25} />
                </span>
              </button>
            ))}
          </>
        )}
      </div>

      {cart.count > 0 && (
        <div className="cart-bar">
          <div className="cart-bar__inner">
            <button type="button" className="btn" onClick={() => setIsCheckoutOpen(true)}>
              <span>Savat · {cart.count}</span>
              <span>{formatMoney(cart.estimatedSubtotal)}</span>
            </button>
          </div>
        </div>
      )}

      {isCheckoutOpen && (
        <CheckoutSheet
          branch={branch}
          cart={cart}
          onClose={() => setIsCheckoutOpen(false)}
          onPlaced={(order) => {
            setIsCheckoutOpen(false);
            setPlacedOrder(order);
          }}
        />
      )}
    </div>
  );
}

/**
 * Shown at the platform's own address, where no restaurant has been named.
 *
 * Deliberately NOT a list of the restaurants on this install: which companies
 * use RESTOR is their business, not a public directory. What a visitor here
 * actually needs is the shape of the link they are missing.
 */
function NoRestaurantChosen() {
  return (
    <div className="center">
      <div style={{ maxWidth: 420 }}>
        <p style={{ fontSize: 46, margin: '0 0 10px', lineHeight: 1 }}>🍽️</p>
        <h1 style={{ fontSize: 21, margin: '0 0 10px', color: 'var(--text)' }}>
          Restoran tanlanmagan
        </h1>
        <p className="muted" style={{ fontSize: 14, lineHeight: 1.65, margin: '0 0 18px' }}>
          Bu manzil — RESTOR platformasining umumiy sahifasi, biror restoranning
          menyusi emas. Buyurtma berish uchun restoranning oʻz havolasini
          oching yoki stoldagi QR kodni skanerlang.
        </p>
        <p
          className="muted"
          style={{
            fontSize: 13,
            margin: 0,
            padding: '10px 14px',
            border: '1px solid var(--border)',
            borderRadius: 10,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >
          {window.location.host}/r/<span style={{ color: 'var(--primary)' }}>restoran</span>
        </p>
      </div>
    </div>
  );
}

function OrderPlaced({ order, onDone }: { order: Order; onDone: () => void }) {
  return (
    <div className="center">
      <div style={{ maxWidth: 360 }}>
        <IconCheckCircle
          size={52}
          strokeWidth={1.5}
          style={{ color: 'var(--primary)', margin: '0 auto 14px' }}
        />
        <h1 style={{ fontSize: 22, margin: '0 0 6px', color: 'var(--text)' }}>
          Buyurtma qabul qilindi
        </h1>
        <p style={{ fontSize: 26, fontWeight: 800, margin: '0 0 6px', color: 'var(--primary)' }}>
          {order.displayNumber}
        </p>
        <p className="muted" style={{ margin: '0 0 4px' }}>
          Summa: {formatMoney(order.total)}
        </p>
        {order.estimatedReadyAt && (
          <p className="muted" style={{ margin: '0 0 20px' }}>
            Taxminiy tayyor boʻlish vaqti:{' '}
            {new Date(order.estimatedReadyAt).toLocaleTimeString('uz-UZ', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        )}
        <button type="button" className="btn" onClick={onDone}>
          Yangi buyurtma
        </button>
      </div>
    </div>
  );
}
