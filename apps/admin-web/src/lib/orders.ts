import { OrderStatus, type Order } from '@restor/shared-types';

/** Statuses where an order still needs someone to do something. */
export const ACTIVE_STATUSES: OrderStatus[] = [
  OrderStatus.NEW,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.WAITING_COURIER,
  OrderStatus.COURIER_ASSIGNED,
  OrderStatus.ON_DELIVERY,
];

/** "Lavash ×2, Fri, Cola" — what was ordered, in one line. */
export function itemsSummary(order: Pick<Order, 'items'>): string {
  if (!order.items?.length) return '—';
  return order.items
    .map((item) => `${item.name}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`)
    .join(', ');
}
