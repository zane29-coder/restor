import { useMemo, useState } from 'react';
import type { MenuProduct } from '@restor/shared-types';
import { IconBasket, IconChevronRight, IconCutlery, IconMessage, IconTrash } from '@restor/ui';
import { ConfirmDialog } from '../components/BottomSheet';
import { ProductImage, RecommendationRow, useQuickAdd } from '../components/product';
import { useProductSheet } from '../components/ProductSheet';
import { useToast } from '../components/Toast';
import { EmptyState, QtyStepper, ScreenHeader } from '../components/ui';
import { som } from '../lib/format';
import { useNav } from '../lib/nav';
import { useCart, type PricedLine } from '../state/cart';
import { useSession } from '../state/session';

/**
 * The cart (TZ 48 §10, §11): the lines with their options, a note to the
 * restaurant, cutlery, "anything else?" and the way to checkout.
 *
 * Amounts here are an estimate from the menu; the checkout screen shows the
 * server's own breakdown, which is what is charged.
 */
export function CartScreen() {
  const session = useSession();
  const cart = useCart();
  const nav = useNav();
  const sheet = useProductSheet();
  const toast = useToast();
  const quickAdd = useQuickAdd(sheet.openProduct);
  const [confirmClear, setConfirmClear] = useState(false);
  const [commentOpen, setCommentOpen] = useState(cart.state.comment.length > 0);

  const unavailable = cart.lines.filter((line) => line.unavailable);
  const inCart = useMemo(() => new Set(cart.lines.map((line) => line.productId)), [cart.lines]);

  const crossSell = useMemo(
    () =>
      (session.menu?.recommendations.cart ?? [])
        .filter((id) => !inCart.has(id))
        .map((id) => session.products.get(id)?.product)
        .filter((product): product is MenuProduct => Boolean(product))
        .slice(0, 12),
    [session.menu, session.products, inCart],
  );

  const branch = session.branch;
  const subtitle = [
    som(cart.estimate),
    branch ? `~${branch.averagePrepMinutes} daq tayyorlanadi` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  if (cart.lines.length === 0) {
    return (
      <div className="screen">
        <ScreenHeader title={session.info.restaurant.name} />
        <EmptyState
          icon={<IconBasket size={32} />}
          title="Savat boʻsh"
          text="Menyudan yoqqan taomni tanlang"
          action={
            <button type="button" className="btn btn--primary" onClick={() => nav.back()}>
              Menyuni ochish
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="screen screen--with-bar">
      <ScreenHeader
        title={session.info.restaurant.name}
        subtitle={subtitle}
        actions={
          <button
            type="button"
            className="icon-btn"
            aria-label="Savatni tozalash"
            onClick={() => setConfirmClear(true)}
          >
            <IconTrash size={22} />
          </button>
        }
      />

      <section className="card-block">
        {cart.lines.map((line) => (
          <CartRow
            key={line.key}
            line={line}
            onEdit={() => sheet.editLine(line)}
            onQuantity={(quantity) => cart.setQuantity(line.key, quantity)}
          />
        ))}

        {unavailable.length > 0 && (
          <div className="notice notice--warn">
            <span>
              {unavailable.length === 1
                ? 'Bitta mahsulot hozir mavjud emas — buyurtmaga kirmaydi.'
                : `${unavailable.length} ta mahsulot hozir mavjud emas — buyurtmaga kirmaydi.`}
            </span>
            <button
              type="button"
              className="link-btn"
              onClick={() => cart.remove(unavailable.map((line) => line.key))}
            >
              Olib tashlash
            </button>
          </div>
        )}

        <button type="button" className="btn btn--secondary btn--block" onClick={() => nav.back()}>
          Menyuni ochish
        </button>
      </section>

      <section className="card-block card-block--row">
        {session.info.checkout.cutleryEnabled && (
          <div className="cutlery" aria-label="Anjomlar soni">
            <IconCutlery size={22} />
            <QtyStepper
              value={cart.state.cutlery}
              size="sm"
              tone="floating"
              label="Anjomlar"
              onDecrement={() => cart.setCutlery(cart.state.cutlery - 1)}
              onIncrement={() => cart.setCutlery(cart.state.cutlery + 1)}
              incrementDisabled={cart.state.cutlery >= 20}
            />
          </div>
        )}
        <button
          type="button"
          className={`note-btn${cart.state.comment ? ' note-btn--filled' : ''}`}
          onClick={() => setCommentOpen((open) => !open)}
          aria-expanded={commentOpen}
        >
          <IconMessage size={20} />
          <span className="note-btn__text">{cart.state.comment || 'Restoranga izoh'}</span>
          <IconChevronRight size={18} />
        </button>
      </section>

      {commentOpen && (
        <section className="card-block">
          <label className="field">
            <span className="field__label">Restoranga izoh</span>
            <textarea
              rows={3}
              maxLength={500}
              placeholder="Masalan: burgerga piyoz qoʻshmang"
              value={cart.state.comment}
              onChange={(event) => cart.setComment(event.target.value)}
            />
            <span className="field__hint">{cart.state.comment.length}/500</span>
          </label>
        </section>
      )}

      {cart.state.cutlery === 0 && session.info.checkout.cutleryEnabled && (
        <p className="hint hint--padded">Anjomlar kerak emas — tabiat uchun rahmat!</p>
      )}

      <RecommendationRow
        title="Yana nimadir kerakmi?"
        products={crossSell}
        onOpen={sheet.openProduct}
        onAdd={(product) => {
          quickAdd(product);
          toast.show(`${product.name} savatga qoʻshildi`, 'success');
        }}
      />

      <div className="bottom-bar">
        <button
          type="button"
          className="btn btn--primary btn--block btn--large"
          disabled={cart.orderable.length === 0}
          onClick={() => nav.push({ name: 'checkout' })}
        >
          <span>Buyurtmani rasmiylashtirish</span>
          <span className="btn__amount">{som(cart.estimate)}</span>
        </button>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="Savatni tozalaysizmi?"
        text="Barcha mahsulotlar savatdan olib tashlanadi."
        confirmLabel="Tozalash"
        danger
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          cart.clear();
        }}
      />
    </div>
  );
}

function CartRow({
  line,
  onEdit,
  onQuantity,
}: {
  line: PricedLine;
  onEdit: () => void;
  onQuantity: (quantity: number) => void;
}) {
  const details = [line.variantName, ...line.modifierNames].filter(Boolean).join(', ');
  const editable = Boolean(
    line.product && (line.product.modifierGroups.length > 0 || line.product.variants.length > 1),
  );

  return (
    <div className={`cart-row${line.unavailable ? ' cart-row--unavailable' : ''}`}>
      <button
        type="button"
        className="cart-row__main"
        onClick={editable && !line.unavailable ? onEdit : undefined}
        disabled={!editable || line.unavailable}
        aria-label={editable ? `${line.product?.name ?? ''} — oʻzgartirish` : undefined}
      >
        <div className="cart-row__thumb">
          <ProductImage src={line.product?.imageUrl ?? null} alt="" />
        </div>
        <div className="cart-row__text">
          <span className="cart-row__name">{line.product?.name ?? 'Mahsulot mavjud emas'}</span>
          {details && <span className="cart-row__details">{details}</span>}
          {line.unavailable ? (
            <span className="cart-row__warn">Hozir mavjud emas</span>
          ) : (
            <span className="cart-row__price">
              {som(line.total)}
              {line.quantity > 1 && <span className="muted"> · {som(line.unitPrice)} dan</span>}
            </span>
          )}
          {editable && !line.unavailable && <span className="cart-row__edit">Oʻzgartirish</span>}
        </div>
      </button>
      <QtyStepper
        value={line.quantity}
        size="sm"
        label={line.product?.name}
        onDecrement={() => onQuantity(line.quantity - 1)}
        onIncrement={() => onQuantity(line.quantity + 1)}
        incrementDisabled={line.unavailable}
      />
    </div>
  );
}
