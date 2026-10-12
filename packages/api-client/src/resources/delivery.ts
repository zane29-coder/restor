import type {
  CashHandover,
  Courier,
  CourierJob,
  CourierProfile,
  CourierStatus,
  CourierTransaction,
  CourierWallet,
  Order,
  Paginated,
  PaginationQuery,
  ReportLocationRequest,
  UpdateCourierProfileRequest,
} from '@restor/shared-types';
import type { HttpClient } from '../http-client';

/** Dispatcher-side courier management (TZ §23-§28). */
export class CouriersResource {
  constructor(private readonly http: HttpClient) {}

  list(
    query?: PaginationQuery & { branchId?: string; status?: CourierStatus },
  ): Promise<Paginated<Courier>> {
    return this.http.getPaginated<Courier>('couriers', { query });
  }

  get(id: string): Promise<Courier> {
    return this.http.get<Courier>(`couriers/${id}`);
  }

  create(payload: unknown): Promise<Courier> {
    return this.http.post<Courier>('couriers', payload);
  }

  update(id: string, payload: unknown): Promise<Courier> {
    return this.http.patch<Courier>(`couriers/${id}`, payload);
  }

  /** Live positions for the dispatcher map. */
  liveLocations(branchId?: string): Promise<Courier[]> {
    return this.http.get<Courier[]>('couriers/live', { query: { branchId } });
  }

  wallet(courierId: string): Promise<CourierWallet> {
    return this.http.get<CourierWallet>(`couriers/${courierId}/wallet`);
  }

  walletTransactions(
    courierId: string,
    query?: PaginationQuery,
  ): Promise<Paginated<CourierTransaction>> {
    return this.http.getPaginated<CourierTransaction>(
      `couriers/${courierId}/wallet/transactions`,
      { query },
    );
  }

  /** Puts a waiting delivery on a courier (TZ §23). */
  assign(
    orderId: string,
    payload: { courierId: string; courierFee?: number; comment?: string },
  ): Promise<Order> {
    return this.http.post<Order>(`orders/${orderId}/courier`, payload);
  }

  /** Gives every delivery waiting for a courier to the best free one. */
  dispatchWaiting(branchId?: string): Promise<{ assigned: number; waiting: number }> {
    return this.http.post<{ assigned: number; waiting: number }>('couriers/dispatch', undefined, {
      query: { branchId },
    });
  }

  /** Couriers ranked by current load, then distance. */
  suggestions(orderId: string): Promise<Array<Courier & { distanceM?: number }>> {
    return this.http.get<Array<Courier & { distanceM?: number }>>(
      `orders/${orderId}/courier-suggestions`,
    );
  }

  /**
   * Cashier confirming cash a courier declared (TZ §28).
   *
   * `amount` is what was actually counted. Omitting it accepts the declared
   * figure; sending a different one records a discrepancy rather than
   * silently overwriting the claim — that difference is the point of a
   * two-sided confirmation.
   */
  confirmHandover(
    handoverId: string,
    payload?: { amount?: number; cashShiftId?: string; comment?: string },
  ): Promise<CashHandover> {
    return this.http.post<CashHandover>(`handovers/${handoverId}/confirm`, payload ?? {});
  }

  listHandovers(query?: PaginationQuery & { branchId?: string; courierId?: string }): Promise<
    Paginated<CashHandover>
  > {
    return this.http.getPaginated<CashHandover>('handovers', { query });
  }
}

/**
 * The courier mobile app's own surface.
 *
 * Every route here is scoped to the authenticated courier server-side — the
 * app never passes its own courier id, so it cannot read another's jobs.
 */
export class CourierAppResource {
  constructor(private readonly http: HttpClient) {}

  /** Profile plus today's delivery count and earnings. */
  myProfile(): Promise<CourierProfile> {
    return this.http.get<CourierProfile>('courier/me');
  }

  /** Changes the number customers call — never the login phone. */
  updateMyProfile(payload: UpdateCourierProfileRequest): Promise<CourierProfile> {
    return this.http.patch<CourierProfile>('courier/me', payload);
  }

  /** Jobs assigned to the signed-in courier (TZ §23). */
  myJobs(): Promise<CourierJob[]> {
    return this.http.get<CourierJob[]>('courier/jobs');
  }

  myJob(deliveryId: string): Promise<CourierJob> {
    return this.http.get<CourierJob>(`courier/jobs/${deliveryId}`);
  }

  accept(deliveryId: string): Promise<CourierJob> {
    return this.http.post<CourierJob>(`courier/jobs/${deliveryId}/accept`);
  }

  startDelivery(deliveryId: string): Promise<CourierJob> {
    return this.http.post<CourierJob>(`courier/jobs/${deliveryId}/start`);
  }

  /** Marks delivered; `collectedCash` credits the courier's wallet. */
  complete(deliveryId: string, collectedCash?: number): Promise<CourierJob> {
    return this.http.post<CourierJob>(`courier/jobs/${deliveryId}/complete`, {
      collectedCash,
    });
  }

  fail(deliveryId: string, reason: string): Promise<CourierJob> {
    return this.http.post<CourierJob>(`courier/jobs/${deliveryId}/fail`, { reason });
  }

  setStatus(status: CourierStatus): Promise<{ status: CourierStatus }> {
    return this.http.post<{ status: CourierStatus }>('courier/status', { status });
  }

  /** GPS ping. Sent only while the courier has granted permission (TZ §25). */
  reportLocation(payload: ReportLocationRequest): Promise<void> {
    return this.http.post<void>('courier/location', payload);
  }

  myWallet(): Promise<CourierWallet> {
    return this.http.get<CourierWallet>('courier/wallet');
  }

  /** My wallet movements, newest first — the courier's own statement. */
  myTransactions(query?: PaginationQuery): Promise<Paginated<CourierTransaction>> {
    return this.http.getPaginated<CourierTransaction>('courier/wallet/transactions', {
      query,
    });
  }

  /**
   * Courier declaring cash handed to the cashier; awaits confirmation.
   *
   * `branchId` is optional: the server falls back to the courier's own branch,
   * which is what the app almost always wants.
   */
  declareHandover(amount: number, branchId?: string): Promise<CashHandover> {
    return this.http.post<CashHandover>('courier/handovers', { amount, branchId });
  }

  /** My hand-offs and whether a cashier has confirmed them yet. */
  myHandovers(): Promise<Paginated<CashHandover>> {
    return this.http.getPaginated<CashHandover>('courier/handovers');
  }
}
