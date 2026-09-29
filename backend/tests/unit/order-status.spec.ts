import {
  ORDER_STATUS_TRANSITIONS,
  OrderStatus,
  TERMINAL_ORDER_STATUSES,
  canTransitionOrderStatus,
} from '@restor/shared-types';

/**
 * The order state machine (TZ §12).
 *
 * Every client — POS, KDS, admin, courier app — reads these rules from the
 * shared package, so a bug here would let one of them drive an order into a
 * state the others cannot handle.
 */
describe('order status transitions', () => {
  it('walks the full delivery happy path', () => {
    const path = [
      OrderStatus.NEW,
      OrderStatus.ACCEPTED,
      OrderStatus.PREPARING,
      OrderStatus.READY,
      OrderStatus.WAITING_COURIER,
      OrderStatus.COURIER_ASSIGNED,
      OrderStatus.ON_DELIVERY,
      OrderStatus.DELIVERED,
    ];

    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransitionOrderStatus(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it('allows a pickup order to finish at READY -> DELIVERED', () => {
    expect(canTransitionOrderStatus(OrderStatus.READY, OrderStatus.DELIVERED)).toBe(true);
  });

  it('refuses to skip the kitchen', () => {
    expect(canTransitionOrderStatus(OrderStatus.NEW, OrderStatus.DELIVERED)).toBe(false);
    expect(canTransitionOrderStatus(OrderStatus.NEW, OrderStatus.READY)).toBe(false);
    expect(canTransitionOrderStatus(OrderStatus.ACCEPTED, OrderStatus.ON_DELIVERY)).toBe(false);
  });

  it('refuses to move backwards', () => {
    expect(canTransitionOrderStatus(OrderStatus.READY, OrderStatus.PREPARING)).toBe(false);
    expect(canTransitionOrderStatus(OrderStatus.DELIVERED, OrderStatus.READY)).toBe(false);
  });

  it('allows cancelling at every stage before delivery', () => {
    const cancellable = [
      OrderStatus.NEW,
      OrderStatus.ACCEPTED,
      OrderStatus.PREPARING,
      OrderStatus.READY,
      OrderStatus.WAITING_COURIER,
      OrderStatus.COURIER_ASSIGNED,
      OrderStatus.ON_DELIVERY,
    ];

    for (const status of cancellable) {
      expect(canTransitionOrderStatus(status, OrderStatus.CANCELLED)).toBe(true);
    }
  });

  it('refuses to cancel an order that is already delivered', () => {
    // Money has changed hands; the correct action is a refund, not a cancel.
    expect(canTransitionOrderStatus(OrderStatus.DELIVERED, OrderStatus.CANCELLED)).toBe(false);
    expect(canTransitionOrderStatus(OrderStatus.DELIVERED, OrderStatus.REFUNDED)).toBe(true);
  });

  it('treats CANCELLED and REFUNDED as dead ends', () => {
    expect(ORDER_STATUS_TRANSITIONS.CANCELLED).toHaveLength(0);
    expect(ORDER_STATUS_TRANSITIONS.REFUNDED).toHaveLength(0);
  });

  it('lets a courier hand an order back to the dispatcher', () => {
    expect(
      canTransitionOrderStatus(OrderStatus.COURIER_ASSIGNED, OrderStatus.WAITING_COURIER),
    ).toBe(true);
  });

  it('defines a transition list for every status', () => {
    for (const status of Object.values(OrderStatus)) {
      expect(ORDER_STATUS_TRANSITIONS[status]).toBeDefined();
    }
  });

  it('marks exactly the end states as terminal', () => {
    expect([...TERMINAL_ORDER_STATUSES].sort()).toEqual(
      [OrderStatus.CANCELLED, OrderStatus.DELIVERED, OrderStatus.REFUNDED].sort(),
    );
  });
});
