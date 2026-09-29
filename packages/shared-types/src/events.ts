/**
 * Internal domain events (TZ §58) and the realtime channel contract (TZ §12).
 *
 * The backend publishes a domain event once, and every listener — Telegram
 * notifier, KDS push, analytics, customer notification — reacts to it. Nothing
 * calls the Telegram API from inside an HTTP handler (TZ §57).
 */

import type {
  CourierStatus,
  DeliveryStatus,
  OrderSource,
  OrderStatus,
  OrderType,
  PaymentMethod,
  WaiterCallType,
} from './enums';

/* -------------------------------------------------------------------------- */
/* Event names                                                                */
/* -------------------------------------------------------------------------- */

export const DomainEvent = {
  ORDER_CREATED: 'order.created',
  ORDER_ACCEPTED: 'order.accepted',
  ORDER_PREPARING: 'order.preparing',
  ORDER_READY: 'order.ready',
  ORDER_STATUS_CHANGED: 'order.status_changed',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_DELIVERED: 'order.delivered',
  PAYMENT_RECEIVED: 'payment.received',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',
  COURIER_ASSIGNED: 'courier.assigned',
  COURIER_STATUS_CHANGED: 'courier.status_changed',
  COURIER_LOCATION_UPDATED: 'courier.location_updated',
  DELIVERY_STATUS_CHANGED: 'delivery.status_changed',
  CASH_SHIFT_OPENED: 'cash_shift.opened',
  CASH_SHIFT_CLOSED: 'cash_shift.closed',
  CASH_HANDOVER_DECLARED: 'cash_handover.declared',
  CASH_HANDOVER_CONFIRMED: 'cash_handover.confirmed',
  WAITER_CALLED: 'waiter.called',
  PRODUCT_STOP_LISTED: 'product.stop_listed',
} as const;
export type DomainEvent = (typeof DomainEvent)[keyof typeof DomainEvent];

/* -------------------------------------------------------------------------- */
/* Event payloads                                                             */
/* -------------------------------------------------------------------------- */

/** Fields carried by every event, so listeners can scope and correlate. */
export interface DomainEventBase {
  tenantId: string;
  branchId: string | null;
  /** Correlates the event with the HTTP request that produced it. */
  requestId: string | null;
  /** User who triggered the action; `null` for system/webhook-driven events. */
  actorUserId: string | null;
  occurredAt: string;
}

export interface OrderCreatedPayload extends DomainEventBase {
  orderId: string;
  displayNumber: string;
  type: OrderType;
  source: OrderSource;
  total: number;
  customerName: string | null;
  customerPhone: string | null;
  itemsSummary: Array<{ name: string; quantity: number }>;
}

export interface OrderStatusChangedPayload extends DomainEventBase {
  orderId: string;
  displayNumber: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  comment: string | null;
}

export interface PaymentReceivedPayload extends DomainEventBase {
  orderId: string;
  displayNumber: string;
  paymentId: string;
  method: PaymentMethod;
  amount: number;
  /** True once the order's payments cover its total. */
  isFullyPaid: boolean;
}

export interface CourierAssignedPayload extends DomainEventBase {
  orderId: string;
  displayNumber: string;
  deliveryId: string;
  courierId: string;
  courierName: string;
}

export interface DeliveryStatusChangedPayload extends DomainEventBase {
  deliveryId: string;
  orderId: string;
  courierId: string | null;
  fromStatus: DeliveryStatus | null;
  toStatus: DeliveryStatus;
}

export interface CourierStatusChangedPayload extends DomainEventBase {
  courierId: string;
  fromStatus: CourierStatus;
  toStatus: CourierStatus;
}

export interface WaiterCalledPayload extends DomainEventBase {
  callId: string;
  tableId: string;
  tableNumber: string;
  type: WaiterCallType;
}

/** Maps each event name to the payload its listeners receive. */
export interface DomainEventMap {
  'order.created': OrderCreatedPayload;
  'order.accepted': OrderStatusChangedPayload;
  'order.preparing': OrderStatusChangedPayload;
  'order.ready': OrderStatusChangedPayload;
  'order.status_changed': OrderStatusChangedPayload;
  'order.cancelled': OrderStatusChangedPayload;
  'order.delivered': OrderStatusChangedPayload;
  'payment.received': PaymentReceivedPayload;
  'payment.failed': PaymentReceivedPayload;
  'payment.refunded': PaymentReceivedPayload;
  'courier.assigned': CourierAssignedPayload;
  'courier.status_changed': CourierStatusChangedPayload;
  'courier.location_updated': DomainEventBase & {
    courierId: string;
    latitude: number;
    longitude: number;
  };
  'delivery.status_changed': DeliveryStatusChangedPayload;
  'cash_shift.opened': DomainEventBase & { shiftId: string; openingCash: number };
  'cash_shift.closed': DomainEventBase & {
    shiftId: string;
    expectedCash: number;
    actualCash: number;
    difference: number;
  };
  'cash_handover.declared': DomainEventBase & {
    handoverId: string;
    courierId: string;
    amount: number;
  };
  'cash_handover.confirmed': DomainEventBase & {
    handoverId: string;
    courierId: string;
    amount: number;
  };
  'waiter.called': WaiterCalledPayload;
  'product.stop_listed': DomainEventBase & { productId: string; name: string };
}

/* -------------------------------------------------------------------------- */
/* Realtime (WebSocket) contract                                              */
/* -------------------------------------------------------------------------- */

/**
 * Rooms a socket can subscribe to. The gateway derives the tenant from the
 * token and refuses any room whose tenant does not match, so a client cannot
 * subscribe its way into another company's traffic.
 */
export const RealtimeRoom = {
  /** Everything happening in one branch — admin dashboards. */
  branch: (branchId: string) => `branch:${branchId}`,
  /** Kitchen display for one branch, optionally narrowed to a station. */
  kitchen: (branchId: string) => `kitchen:${branchId}`,
  /** POS terminals of one branch. */
  pos: (branchId: string) => `pos:${branchId}`,
  /** A single order — used by the customer's order-tracking screen. */
  order: (orderId: string) => `order:${orderId}`,
  /** One courier's own jobs. */
  courier: (courierId: string) => `courier:${courierId}`,
  /** Dispatcher map of every courier in a tenant. */
  dispatch: (tenantId: string) => `dispatch:${tenantId}`,
} as const;

/** Messages the server pushes to clients. */
export const RealtimeEvent = {
  ORDER_CREATED: 'order:created',
  ORDER_UPDATED: 'order:updated',
  ORDER_STATUS: 'order:status',
  KITCHEN_TICKET_CREATED: 'kitchen:ticket_created',
  KITCHEN_TICKET_UPDATED: 'kitchen:ticket_updated',
  COURIER_LOCATION: 'courier:location',
  COURIER_JOB_ASSIGNED: 'courier:job_assigned',
  WAITER_CALL: 'waiter:call',
  STOP_LIST_CHANGED: 'menu:stop_list_changed',
} as const;
export type RealtimeEvent = (typeof RealtimeEvent)[keyof typeof RealtimeEvent];

/** Envelope for every realtime message. */
export interface RealtimeMessage<T = unknown> {
  event: RealtimeEvent;
  room: string;
  data: T;
  sentAt: string;
}
