import { useEffect, useState } from 'react';
import {
  OrderSource,
  OrderType,
  type BranchSummary,
  type CreateOrderRequest,
  type Order,
  type OrderPricePreview,
} from '@restor/shared-types';
import { formatMoney } from '@restor/shared-utils';
import { RestorApiError } from '@restor/api-client';
import { api } from './api';
import type { CartApi } from './useCart';

/**
 * Cart review and checkout (TZ §11).
 *
 * The totals are fetched from `/orders/preview` rather than summed locally:
 * only the server knows the delivery fee, the active promotions and whether a
 * promo code applies, and it is the same code path that prices the real order.
 */
export function CheckoutSheet({
  branch,
  cart,
  onClose,
  onPlaced,
}: {
  branch: BranchSummary;
  cart: CartApi;
  onClose: () => void;
  onPlaced: (order: Order) => void;
}) {
  const [orderType, setOrderType] = useState<OrderType>(OrderType.PICKUP);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [comment, setComment] = useState('');
  const [promoCode, setPromoCode] = useState('');

  const [preview, setPreview] = useState<OrderPricePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Re-price whenever anything that affects the total changes.
  useEffect(() => {
    if (cart.lines.length === 0) return;

    let cancelled = false;
    setIsPreviewing(true);

    void api.orders
      .preview({
        branchId: branch.id,
        type: orderType,
        items: cart.lines.map((line) => ({
          productId: line.productId,
          ...(line.variantId ? { variantId: line.variantId } : {}),
          quantity: line.quantity,
          modifierIds: line.modifierIds,
        })),
        ...(promoCode.trim() ? { promoCode: promoCode.trim() } : {}),
      })
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        setError(null);
      })
      .catch((caught) => {
        if (cancelled) return;
        setPreview(null);
        setError(caught instanceof RestorApiError ? caught.message : 'Narxni hisoblab boʻlmadi');
      })
      .finally(() => {
        if (!cancelled) setIsPreviewing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [branch.id, orderType, cart.lines, promoCode]);

  async function placeOrder() {
    setIsSubmitting(true);
    setError(null);

    const payload: CreateOrderRequest = {
      branchId: branch.id,
      type: orderType,
      source: OrderSource.WEB,
      // Generated up-front so a retry cannot create a second order (TZ §18).
      clientUuid: crypto.randomUUID(),
      items: cart.lines.map((line) => ({
        productId: line.productId,
        ...(line.variantId ? { variantId: line.variantId } : {}),
        quantity: line.quantity,
        modifierIds: line.modifierIds,
      })),
      customer: { name: name.trim() || undefined, phone: phone.trim() },
      ...(orderType === OrderType.DELIVERY ? { deliveryAddress: { address: address.trim() } } : {}),
      ...(comment.trim() ? { comment: comment.trim() } : {}),
      ...(promoCode.trim() ? { promoCode: promoCode.trim() } : {}),
    };

    try {
      onPlaced(await api.orders.create(payload));
    } catch (caught) {
      setError(caught instanceof RestorApiError ? caught.message : 'Buyurtma yuborilmadi');
    } finally {
      setIsSubmitting(false);
    }
  }

  const needsAddress = orderType === OrderType.DELIVERY;
  const canSubmit =
    cart.lines.length > 0 &&
    phone.trim().length >= 9 &&
    (!needsAddress || address.trim().length >= 5) &&
    !isSubmitting &&
    !isPreviewing;

  return (
    <div
      className="sheet"
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        // Only a click on the backdrop itself closes the sheet.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet__panel">
        <div className="sheet__handle" />

        <h2 style={{ fontSize: 19, margin: '0 0 14px' }}>Savat</h2>

        {cart.lines.map((line) => (
          <div key={line.key} className="line">
            <div className="line__body">
              <div style={{ fontWeight: 600 }}>{line.name}</div>
              {line.variantName && <div className="muted" style={{ fontSize: 13 }}>{line.variantName}</div>}
              {line.modifierNames.length > 0 && (
                <div className="muted" style={{ fontSize: 13 }}>
                  + {line.modifierNames.join(', ')}
                </div>
              )}
              <div className="muted" style={{ fontSize: 13 }}>{formatMoney(line.unitPrice)}</div>
            </div>
            <div className="qty">
              <button
                type="button"
                className="qty__btn"
                onClick={() => cart.changeQuantity(line.key, -1)}
                aria-label="Kamaytirish"
              >
                −
              </button>
              <strong style={{ minWidth: 18, textAlign: 'center' }}>{line.quantity}</strong>
              <button
                type="button"
                className="qty__btn"
                onClick={() => cart.changeQuantity(line.key, 1)}
                aria-label="Koʻpaytirish"
              >
                +
              </button>
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
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
          <label htmlFor="c-phone">Telefon *</label>
          <input
            id="c-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+998 90 123 45 67"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="c-name">Ism</label>
          <input
            id="c-name"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        {needsAddress && (
          <div className="field">
            <label htmlFor="c-address">Manzil *</label>
            <input
              id="c-address"
              autoComplete="street-address"
              placeholder="Koʻcha, uy, xonadon"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              required
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="c-promo">Promo-kod</label>
          <input
            id="c-promo"
            value={promoCode}
            onChange={(event) => setPromoCode(event.target.value.toUpperCase())}
            placeholder="ixtiyoriy"
          />
        </div>

        <div className="field">
          <label htmlFor="c-comment">Izoh</label>
          <textarea
            id="c-comment"
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
              <div className="totals__row" style={{ color: 'var(--primary-dark)' }}>
                <span>Chegirma</span>
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
            {preview.warnings.map((warning) => (
              <p key={warning} className="muted" style={{ fontSize: 13, margin: 0 }}>
                ⚠ {warning}
              </p>
            ))}
          </div>
        )}

        <button
          type="button"
          className="btn"
          disabled={!canSubmit}
          onClick={() => void placeOrder()}
        >
          {isSubmitting
            ? 'Yuborilmoqda…'
            : isPreviewing
              ? 'Hisoblanmoqda…'
              : `Buyurtma berish · ${preview ? formatMoney(preview.total) : ''}`}
        </button>

        <button
          type="button"
          className="btn btn--ghost"
          style={{ marginTop: 8 }}
          onClick={onClose}
        >
          Yopish
        </button>
      </div>
    </div>
  );
}
