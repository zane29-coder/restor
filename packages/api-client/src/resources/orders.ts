import type {
  AssignCourierRequest,
  BranchReportRow,
  CreateOrderRequest,
  CreatePaymentRequest,
  DashboardStats,
  FinanceReport,
  KitchenTicket,
  MixedPaymentRequest,
  Order,
  OrderListQuery,
  OrderPricePreview,
  OrderStatus,
  OrderStatusHistoryEntry,
  Paginated,
  Payment,
  PromotionStats,
  RefundRequest,
  SalesReport,
  TopProductRow,
  UpdateOrderStatusRequest,
} from '@restor/shared-types';
import type { HttpClient } from '../http-client';

export class OrdersResource {
  constructor(private readonly http: HttpClient) {}

  list(query?: OrderListQuery): Promise<Paginated<Order>> {
    return this.http.getPaginated<Order>('orders', { query });
  }

  /** Orders per status under the same filters as `list` (status ignored). */
  counts(query?: Omit<OrderListQuery, 'status' | 'page' | 'limit'>): Promise<Record<OrderStatus, number>> {
    return this.http.get<Record<OrderStatus, number>>('orders/counts', { query });
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
    return this.http.get<Payment[]>(`payments/order/${orderId}`);
  }

  /* --------------------------- Online (Subo) ------------------------ */

  /**
   * Whether online payment is configured.
   *
   * Reports only state — the API key is write-only, because Subo shows a
   * merchant key once and a leak from here would be unrecoverable.
   */
  suboConfig(): Promise<SuboConfigView> {
    return this.http.get<SuboConfigView>('payments/subo/config');
  }

  saveSuboConfig(payload: { apiKey?: string; isActive?: boolean }): Promise<SuboConfigView> {
    return this.http.post<SuboConfigView>('payments/subo/config', payload);
  }

  /**
   * Creates or resumes a Subo checkout for an order.
   *
   * Resuming is the point: a customer who closed the tab is sent back to the
   * same session rather than given a second live charge for one order.
   *
   * Omitting `provider` makes Subo use the first provider configured in the
   * merchant's Subo panel (docs.subo.uz). Naming `ATMOS` forces the card
   * path, which is the only one that saves a card for next time.
   */
  startCheckout(payload: {
    orderId: string;
    provider?: SuboProvider;
    returnUrl?: string;
  }): Promise<SuboCheckout> {
    return this.http.post<SuboCheckout>('payments/subo/checkout', payload);
  }

  /** Online attempts for an order — poll this after the customer returns. */
  listCheckouts(orderId: string): Promise<Payment[]> {
    return this.http.get<Payment[]>(`payments/subo/order/${orderId}`);
  }
}

/** Subo aggregates these three behind one hosted checkout. */
export type SuboProvider = 'ATMOS' | 'CLICK' | 'PAYME';

export interface SuboCheckout {
  paymentId: string;
  orderId: string;
  suboOrderId: string;
  /** Send the customer here; valid for 30 minutes. */
  checkoutUrl: string;
  expiresAt: string | null;
  amount: number;
  status: string;
}

export interface SuboConfigView {
  provider: string;
  hasKey: boolean;
  isSandbox: boolean;
  isActive: boolean;
  /** Where Subo posts callbacks; paste this into their dashboard. */
  callbackUrl: string;
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

  dashboard(query?: ReportQuery): Promise<DashboardStats> {
    return this.http.get<DashboardStats>('reports/dashboard', { query });
  }

  /** Revenue by type, source, tender and time. */
  sales(query?: ReportQuery & { granularity?: Granularity }): Promise<SalesReport> {
    return this.http.get<SalesReport>('reports/sales', { query });
  }

  /** Ranked by revenue, with an ABC split for kitchen planning. */
  products(query?: ReportQuery & { limit?: number }): Promise<TopProductRow[]> {
    return this.http.get<TopProductRow[]>('reports/products', { query });
  }

  /** Every branch side by side, best first, with its daily target. */
  branches(query?: Omit<ReportQuery, 'branchId'>): Promise<BranchReportRow[]> {
    return this.http.get<BranchReportRow[]>('reports/branches', { query });
  }

  /** Uses, discount and revenue per promotion, promo code and branch. */
  promotions(query?: ReportQuery): Promise<PromotionStats> {
    return this.http.get<PromotionStats>('reports/promotions', { query });
  }

  /** Shift totals and every closing discrepancy. Needs `finance.view`. */
  finance(query?: ReportQuery): Promise<FinanceReport> {
    return this.http.get<FinanceReport>('reports/finance', { query });
  }
}

/** Dates are `YYYY-MM-DD`; the server resolves them in the branch's timezone. */
export interface ReportQuery {
  branchId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export type Granularity = 'hour' | 'day' | 'week' | 'month';
