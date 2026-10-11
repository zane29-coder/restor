import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FavoriteProduct } from '@restor/shared-types';
import { IconHeart, IconHeartFilled } from '@restor/ui';
import { api } from '../api';
import { ProductImage } from '../components/product';
import { useProductSheet } from '../components/ProductSheet';
import { useToast } from '../components/Toast';
import { EmptyState, ErrorState, ListSkeleton, ScreenHeader } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { som } from '../lib/format';
import { useSession } from '../state/session';

/**
 * "Tanlanganlar" (TZ 48 §19): hearted dishes from every restaurant, grouped
 * by restaurant. Only this restaurant's can open its sheet and go into this
 * cart; the others say where they are from.
 */
export function FavoritesScreen({ active }: { active: boolean }) {
  const session = useSession();
  const sheet = useProductSheet();
  const toast = useToast();
  const [favorites, setFavorites] = useState<FavoriteProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.me
      .favorites()
      .then((result) => {
        setFavorites(result);
        setError(null);
      })
      .catch((caught) => setError(errorMessage(caught, 'Tanlanganlar yuklanmadi')));
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const groups = useMemo(() => {
    const byRestaurant = new Map<string, { name: string; current: boolean; items: FavoriteProduct[] }>();
    for (const item of favorites ?? []) {
      const group = byRestaurant.get(item.restaurantSlug) ?? {
        name: item.restaurantName,
        current: item.isCurrentRestaurant,
        items: [],
      };
      group.items.push(item);
      byRestaurant.set(item.restaurantSlug, group);
    }
    // This restaurant first.
    return [...byRestaurant.values()].sort((a, b) => Number(b.current) - Number(a.current));
  }, [favorites]);

  async function unfavorite(item: FavoriteProduct) {
    setFavorites((current) => current?.filter((entry) => entry.productId !== item.productId) ?? null);
    try {
      if (item.isCurrentRestaurant) {
        await session.toggleFavorite(item.productId);
      } else {
        await api.me.removeFavorite(item.productId);
      }
    } catch (caught) {
      toast.show(errorMessage(caught), 'error');
      load();
    }
  }

  return (
    <div className="screen screen--tinted">
      <ScreenHeader title="Tanlanganlar" />

      {error && !favorites ? (
        <ErrorState message={error} onRetry={load} />
      ) : !favorites ? (
        <ListSkeleton rows={4} />
      ) : favorites.length === 0 ? (
        <EmptyState
          icon={<IconHeart size={30} />}
          title="Hali tanlangan taom yoʻq"
          text="Taom sahifasidagi yurakcha belgisini bosing"
        />
      ) : (
        groups.map((group) => (
          <section key={group.name} className="card-block">
            <h2 className="block-title">
              {group.name}
              {!group.current && <span className="badge-soft">Boshqa restoran</span>}
            </h2>
            {group.items.map((item) => {
              const onMenu = item.isCurrentRestaurant ? session.products.get(item.productId)?.product : undefined;
              return (
                <div key={item.productId} className="fav-row">
                  <button
                    type="button"
                    className="fav-row__main"
                    disabled={!onMenu}
                    onClick={() => onMenu && sheet.openProduct(onMenu)}
                  >
                    <div className="fav-row__thumb">
                      <ProductImage src={item.imageUrl} alt="" />
                    </div>
                    <span className="fav-row__text">
                      <span className="fav-row__name">{item.name}</span>
                      <span className="fav-row__meta">
                        {onMenu
                          ? som(onMenu.price)
                          : !item.isCurrentRestaurant
                            ? `${item.restaurantName} menyusida`
                            : item.isActive
                              ? 'Bu filialda hozir mavjud emas'
                              : 'Sotuvda yoʻq'}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--active"
                    aria-label="Tanlanganlardan olib tashlash"
                    onClick={() => void unfavorite(item)}
                  >
                    <IconHeartFilled size={22} />
                  </button>
                </div>
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}
