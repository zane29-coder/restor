import { useEffect, useMemo, useRef, useState } from 'react';
import { IconClose, IconSearch } from '@restor/ui';
import { ProductCard, useQuickAdd } from '../components/product';
import { useProductSheet } from '../components/ProductSheet';
import { EmptyState, ScreenHeader } from '../components/ui';
import { searchKey } from '../lib/format';
import { useCart } from '../state/cart';
import { useSession } from '../state/session';

/** Finds a dish by name or description in the loaded menu — no request needed. */
export function SearchScreen({ active }: { active: boolean }) {
  const session = useSession();
  const cart = useCart();
  const sheet = useProductSheet();
  const quickAdd = useQuickAdd(sheet.openProduct);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  const results = useMemo(() => {
    const needle = searchKey(query);
    if (needle.length < 2) return [];
    return [...session.products.values()]
      .filter(({ product, categoryName }) =>
        searchKey(`${product.name} ${product.description ?? ''} ${categoryName}`).includes(needle),
      )
      .map(({ product }) => product)
      .slice(0, 60);
  }, [query, session.products]);

  return (
    <div className="screen">
      <ScreenHeader title="Qidiruv" />
      <div className="search-box">
        <IconSearch size={20} />
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          placeholder="Taom yoki ichimlik nomi"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Menyudan qidirish"
        />
        {query && (
          <button type="button" className="icon-btn icon-btn--sm" aria-label="Tozalash" onClick={() => setQuery('')}>
            <IconClose size={18} />
          </button>
        )}
      </div>

      {searchKey(query).length < 2 ? (
        <EmptyState title="Nimani qidiramiz?" text="Kamida 2 ta harf kiriting" />
      ) : results.length === 0 ? (
        <EmptyState title="Hech narsa topilmadi" text="Boshqa soʻz bilan qidirib koʻring" />
      ) : (
        <div className="product-grid product-grid--padded">
          {results.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              quantity={cart.quantityOf(product.id)}
              onOpen={sheet.openProduct}
              onAdd={quickAdd}
              onDecrement={cart.decrementProduct}
            />
          ))}
        </div>
      )}
    </div>
  );
}
