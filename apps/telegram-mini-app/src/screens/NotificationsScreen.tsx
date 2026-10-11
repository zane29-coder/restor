import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  CustomerNotificationType,
  type CustomerNotificationItem,
} from '@restor/shared-types';
import {
  IconAlert,
  IconBell,
  IconCard,
  IconCheckCircle,
  IconClock,
  IconCourier,
  IconInfo,
  IconKitchen,
  IconOrders,
  IconTag,
} from '@restor/ui';
import { api } from '../api';
import { EmptyState, ErrorState, ListSkeleton, ScreenHeader } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { relativeTime } from '../lib/format';
import { useNav } from '../lib/nav';
import { useSession } from '../state/session';

const PAGE_SIZE = 30;

const ICONS: Record<CustomerNotificationType, ReactNode> = {
  ORDER_RECEIVED: <IconOrders size={22} />,
  ORDER_ACCEPTED: <IconCheckCircle size={22} />,
  ORDER_PREPARING: <IconKitchen size={22} />,
  ORDER_READY: <IconBell size={22} />,
  ORDER_ON_DELIVERY: <IconCourier size={22} />,
  ORDER_DELIVERED: <IconCheckCircle size={22} />,
  ORDER_CANCELLED: <IconAlert size={22} />,
  PAYMENT_RECEIVED: <IconCard size={22} />,
  PAYMENT_FAILED: <IconAlert size={22} />,
  NEW_PRODUCT: <IconTag size={22} />,
  PROMOTION: <IconTag size={22} />,
  PROMO_CODE: <IconTag size={22} />,
  SERVICE: <IconInfo size={22} />,
};

/**
 * The inbox (TZ 48 §16). Every message the bot sent about an order is here
 * too, word for word — both come from the same row on the server.
 */
export function NotificationsScreen({ active }: { active: boolean }) {
  const session = useSession();
  const nav = useNav();
  const [items, setItems] = useState<CustomerNotificationItem[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((nextPage: number) => {
    api.me
      .notifications({ page: nextPage, limit: PAGE_SIZE })
      .then((result) => {
        setItems((current) => (nextPage === 1 ? result.items : [...(current ?? []), ...result.items]));
        setHasMore(result.pagination.hasNext);
        setPage(nextPage);
        setError(null);
      })
      .catch((caught) => setError(errorMessage(caught, 'Bildirishnomalar yuklanmadi')));
  }, []);

  useEffect(() => {
    if (active) load(1);
  }, [active, load]);

  async function markAll() {
    await api.me.markNotificationsRead().catch(() => undefined);
    setItems((current) => current?.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })) ?? null);
    session.refreshUnread();
  }

  async function open(item: CustomerNotificationItem) {
    if (!item.readAt) {
      setItems((current) =>
        current?.map((entry) => (entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry)) ?? null,
      );
      void api.me.markNotificationsRead([item.id]).then(session.refreshUnread).catch(() => undefined);
    }
    if (item.orderId) nav.push({ name: 'order', id: item.orderId });
  }

  const hasUnread = items?.some((item) => !item.readAt) ?? false;

  return (
    <div className="screen screen--tinted">
      <ScreenHeader
        title="Bildirishnomalar"
        actions={
          hasUnread ? (
            <button type="button" className="link-btn" onClick={() => void markAll()}>
              Barchasini oʻqish
            </button>
          ) : undefined
        }
      />

      {error && !items ? (
        <ErrorState message={error} onRetry={() => load(1)} />
      ) : !items ? (
        <ListSkeleton rows={5} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<IconBell size={30} />}
          title="Bildirishnoma yoʻq"
          text="Buyurtmalaringiz holati va aksiyalar shu yerda koʻrinadi"
        />
      ) : (
        <div className="list">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`notification${item.readAt ? '' : ' notification--unread'}`}
              onClick={() => void open(item)}
            >
              <span className={`notification__icon notification__icon--${item.category.toLowerCase()}`}>
                {ICONS[item.type] ?? <IconInfo size={22} />}
              </span>
              <span className="notification__text">
                <span className="notification__title">{item.title}</span>
                <span className="notification__body">{item.body}</span>
                <span className="notification__meta">
                  <IconClock size={12} />
                  {relativeTime(item.createdAt)}
                  {item.restaurantName && ` · ${item.restaurantName}`}
                </span>
              </span>
              {!item.readAt && <span className="notification__dot" aria-label="Oʻqilmagan" />}
            </button>
          ))}
          {hasMore && (
            <button type="button" className="btn btn--secondary btn--block" onClick={() => load(page + 1)}>
              Yana koʻrsatish
            </button>
          )}
        </div>
      )}
    </div>
  );
}
