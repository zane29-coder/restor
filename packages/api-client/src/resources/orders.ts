import type {
  AssignCourierRequest,
  CreateOrderRequest,
  CreatePaymentRequest,
  DashboardStats,
  KitchenTicket,
  MixedPaymentRequest,
  Order,
  OrderListQuery,
  OrderPricePreview,
  OrderStatusHistoryEntry,
  Paginated,
  Payment,
  RefundRequest,
  UpdateOrderStatusRequest,
} from '@restor/shared-types';
import type { HttpClient } from '../http-client';

export class OrdersResource {
  constructor(private readonly http: HttpClient) {}

  list(query?: OrderListQuery): Promise<Paginated<Order>> {
    return this.http.get<Paginated<Order>>('orders', { query });
  }

  get(id: string): Promise<Order> {
    return this.http.get<Order>(`orders/${id}`);
  }

  /**
   * Prices a cart without persisting anything, so the customer sees the exact
   * total — including promotions and delivery — before confirming.
   */
  preview(payload: Omit<CreateOrderRequest, 'clientUuid'>): Promise<OrderPricePreview> {
    return this.http.post<OrderPricePreview>('orders/preview', payload);
  }

  /**
   * Creates an order.
   *
   * When `clientUuid` is set it is also sent as the idempotency key, so a POS
   * replaying a queued offline order gets back the original instead of a
   * duplicate (TZ §18).
   */
  create(payload: CreateOrderRequest): Promise<Order> {
    return this.http.post<Order>('orders', payload, {
      idempotencyKey: payload.clientUuid,
    });
  }

  updateStatus(id: string, payload: UpdateOrderStatusRequest): Promise<Order> {
    return this.http.patch<Order>(`orders/${id}/status`, payload);
  }

  cancel(id: string, cancelReason: string): Promise<Order> {
    return this.http.patch<Order>(`orders/${id}/status`, {
      status: 'CANCELLED',
      cancelReason,
    });
  }

  assignCourier(id: string, payload: AssignCourierRequest): Promise<Order> {
    return this.http.post<Order>(`orders/${id}/courier`, payload);
  }

  /** Full timeline of the order (TZ §13). */
  timeline(id: string): Promise<OrderStatusHistoryEntry[]> {
    return this.http.get<OrderStatusHistoryEntry[]>(`orders/${id}/timeline`);
  }

  /** Public tracking for the customer, keyed by the order's display number. */
  track(displayNumber: string, phone: string): Promise<Order> {
    return this.http.get<Order>('orders/track', {
      query: { number: displayNumber, phone },
      skipAuth: true,
    });
  }
}

export class PaymentsResource {
  constructor(private readonly http: HttpClient) {}

  create(payload: CreatePaymentRequest): Promise<Payment> {
    return this.http.post<Payment>('payments', payload);
  }

  /** Several tenders settling one order at once (TZ §17). */
  createMixed(payload: MixedPaymentRequest): Promise<Payment[]> {
    return this.http.post<Payment[]>('payments/mixed', payload);
  }

  refund(payload: RefundRequest): Promise<Payment> {
    return this.http.post<Payment>('payments/refund', payload);
  }

  listForOrder(orderId: string): Promise<Payment[]> {
    return this.http.get<Payment[]>(`orders/${orderId}/payments`);
  }
}

export class KitchenResource {
  constructor(private readonly http: HttpClient) {}

  /** Open tickets for one branch, optionally narrowed to a station (TZ §22). */
  tickets(branchId: string, stationId?: string): Promise<KitchenTicket[]> {
    return this.http.get<KitchenTicket[]>('kitchen/tickets', {
      query: { branchId, stationId },
    });
  }

  start(ticketId: string): Promise<KitchenTicket> {
    return this.http.post<KitchenTicket>(`kitchen/tickets/${ticketId}/start`);
  }

  ready(ticketId: string): Promise<KitchenTicket> {
    return this.http.post<KitchenTicket>(`kitchen/tickets/${ticketId}/ready`);
  }
}

export class ReportsResource {
  constructor(private readonly http: HttpClient) {}

  dashboard(query?: {
    branchId?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<DashboardStats> {
    return this.http.get<DashboardStats>('reports/dashboard', { query });
  }
}
