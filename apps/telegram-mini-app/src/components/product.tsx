import { memo, useState } from 'react';
import type { MenuProduct } from '@restor/shared-types';
import {
  defaultModifierIds,
  defaultVariantId,
  formatPortion,
  needsConfiguration,
} from '@restor/shared-utils';
import { IconMenu, IconPlus } from '@restor/ui';
import { som } from '../lib/format';
import { useCart } from '../state/cart';
import { haptic } from '../telegram';
import { QtyStepper } from './ui';

/**
 * A product photo, loaded lazily and decoded off the main thread. A missing
 * or broken image falls back to a drawn plate rather than a broken-image
 * icon, so the grid keeps its rhythm.
 */
export function ProductImage({
  src,
  alt,
  eager,
  className,
}: {
  src: string | null;
  alt: string;
  eager?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className={`product-image product-image--empty${className ? ` ${className}` : ''}`} aria-hidden="true">
        <IconMenu size={40} strokeWidth={1.25} />
      </div>
    );
  }

  return (
    <img
      className={`product-image${className ? ` ${className}` : ''}`}
      src={src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * The "+" on a card or a recommendation.
 *
 * Adds straight to the cart when the product needs no decision — the
 * restaurant's default options included — and opens the product sheet when
 * it has a size or a required choice to make.
 */
export function useQuickAdd(openProduct: (product: MenuProduct) => void) {
  const cart = useCart();
  return (product: MenuProduct) => {
    if (needsConfiguration(product)) {
      openProduct(product);
      return;
    }
    haptic('light');
    cart.add(product, defaultVariantId(product), defaultModifierIds(product.modifierGroups));
  };
}

export const ProductCard = memo(function ProductCard({
  product,
  quantity,
  onOpen,
  onAdd,
  onDecrement,
  eagerImage,
}: {
  product: MenuProduct;
  quantity: number;
  onOpen: (product: MenuProduct) => void;
  onAdd: (product: MenuProduct) => void;
  onDecrement: (productId: string) => void;
  eagerImage?: boolean;
}) {
  const portion = formatPortion(product.portionSize, product.portionUnit);

  return (
    <article className="product-card">
      <button
        type="button"
        className="product-card__open"
        onClick={() => onOpen(product)}
        aria-label={`${product.name}, ${som(product.price)}`}
      >
        <div className="product-card__media">
          <ProductImage src={product.imageUrl} alt="" eager={eagerImage} />
        </div>
        <div className="product-card__price">
          <span>{som(product.price)}</span>
          {product.oldPrice && <s className="product-card__old">{som(product.oldPrice)}</s>}
        </div>
        <div className="product-card__name">{product.name}</div>
        {portion && <div className="product-card__meta">{portion}</div>}
      </button>

      <div className={`product-card__control${quantity > 0 ? ' product-card__control--wide' : ''}`}>
        {quantity > 0 ? (
          <QtyStepper
            value={quantity}
            tone="floating"
            size="sm"
            label={product.name}
            onDecrement={() => onDecrement(product.id)}
            onIncrement={() => onAdd(product)}
          />
        ) : (
          <button
            type="button"
            className="add-btn"
            aria-label={`${product.name} — savatga qoʻshish`}
            onClick={() => onAdd(product)}
          >
            <IconPlus size={22} strokeWidth={2.25} />
          </button>
        )}
      </div>
    </article>
  );
});

/**
 * "Sizga yoqishi mumkin" / "Yana nimadir kerakmi?": a horizontal row of
 * small cards. The ids arrive already filtered to what this branch sells.
 */
export function RecommendationRow({
  title,
  products,
  onOpen,
  onAdd,
}: {
  title: string;
  products: MenuProduct[];
  onOpen: (product: MenuProduct) => void;
  onAdd: (product: MenuProduct) => void;
}) {
  if (products.length === 0) return null;

  return (
    <section className="reco" aria-label={title}>
      <h3 className="reco__title">{title}</h3>
      <div className="reco__row">
        {products.map((product) => (
          <article key={product.id} className="reco-card">
            <button type="button" className="reco-card__open" onClick={() => onOpen(product)}>
              <div className="reco-card__media">
                <ProductImage src={product.imageUrl} alt="" />
              </div>
              <div className="reco-card__price">{som(product.price)}</div>
              <div className="reco-card__name">{product.name}</div>
            </button>
            <button
              type="button"
              className="add-btn add-btn--sm reco-card__add"
              aria-label={`${product.name} — savatga qoʻshish`}
              onClick={() => onAdd(product)}
            >
              <IconPlus size={18} strokeWidth={2.25} />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
