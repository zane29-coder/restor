import { useCallback, useEffect, useState } from 'react';
import type { MyOrderSummary } from '@restor/shared-types';
import { IconChevronRight, IconOrders } from '@restor/ui';
import { api } from '../api';
import { EmptyState, ErrorState, ListSkeleton, ScreenHeader } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, dateTime, paymentLabel, som, statusTone } from '../lib/format';
import { useNav } from '../lib/nav';

const PAGE_SIZE = 20;

/** Order history across every restaurant the customer ordered from. */
export function OrdersScreen({ active }: { active: boolean }) {
  const nav = useNav();
  const [orders, setOrders] = useState<MyOrderSummary[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback((nextPage: number) => {
    setLoadingMore(nextPage > 1);
    api.me
      .orders({ page: nextPage, limit: PAGE_SIZE })
      .then((result) => {
        setOrders((current) => (nextPage === 1 ? result.items : [...(current ?? []), ...result.items]));
        setHasMore(result.pagination.hasNext);
        setPage(nextPage);
        setError(null);
      })
      .catch((caught) => setError(errorMessage(caught, 'Buyurtmalar yuklanmadi')))
      .finally(() => setLoadingMore(false));
  }, []);

  useEffect(() => {
    if (active) load(1);
  }, [active, load]);

  return (
    <div className="screen">
      <ScreenHeader title="Buyurtmalar tarixi" />

      {error && !orders ? (
        <ErrorState message={error} onRetry={() => load(1)} />
      ) : !orders ? (
        <ListSkeleton rows={5} />
      ) : orders.length === 0 ? (
        <EmptyState icon={<IconOrders size={30} />} title="Hali buyurtma yoʻq" text="Birinchi buyurtmangiz shu yerda koʻrinadi" />
      ) : (
        <div className="list">
          {orders.map((order) => (
            <button
              key={order.id}
              type="button"
              className="order-card"
              onClick={() => nav.push({ name: 'order', id: order.id })}
            >
              <div className="order-card__head">
                <span className="order-card__restaurant">{order.restaurantName}</span>
                <span className={`chip chip--${statusTone(order.status)}`}>{ORDER_STATUS_LABELS[order.status]}</span>
              </div>
              <div className="order-card__meta">
                {order.displayNumber} · {dateTime(order.createdAt)}
              </div>
              <div className="order-card__items">
                {order.itemsPreview.join(', ')}
                {order.itemCount > order.itemsPreview.length && ' …'}
              </div>
              <div className="order-card__foot">
                <span className="order-card__total">{som(order.total)}</span>
                <span className="muted">
                  {paymentLabel(order.paymentMethod, order.paymentProvider)} · {PAYMENT_STATUS_LABELS[order.paymentStatus]}
                </span>
                <IconChevronRight size={18} />
              </div>
            </button>
          ))}
          {hasMore && (
            <button
              type="button"
              className="btn btn--secondary btn--block"
              disabled={loadingMore}
              onClick={() => load(page + 1)}
            >
              {loadingMore ? 'Yuklanmoqda…' : 'Yana koʻrsatish'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
