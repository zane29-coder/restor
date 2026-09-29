import type {
  CashHandover,
  Courier,
  CourierJob,
  CourierStatus,
  CourierTransaction,
  CourierWallet,
  Paginated,
  PaginationQuery,
  ReportLocationRequest,
} from '@restor/shared-types';
import type { HttpClient } from '../http-client';

/** Dispatcher-side courier management (TZ §23-§28). */
export class CouriersResource {
  constructor(private readonly http: HttpClient) {}

  list(
    query?: PaginationQuery & { branchId?: string; status?: CourierStatus },
  ): Promise<Paginated<Courier>> {
    return this.http.get<Paginated<Courier>>('couriers', { query });
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
    return this.http.get<Paginated<CourierTransaction>>(
      `couriers/${courierId}/wallet/transactions`,
      { query },
    );
  }

  /** Cashier confirming cash a courier declared (TZ §28). */
  confirmHandover(handoverId: string): Promise<CashHandover> {
    return this.http.post<CashHandover>(`handovers/${handoverId}/confirm`);
  }

  listHandovers(query?: PaginationQuery & { branchId?: string; courierId?: string }): Promise<
    Paginated<CashHandover>
  > {
    return this.http.get<Paginated<CashHandover>>('handovers', { query });
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

  /** Courier declaring cash handed to the cashier; awaits confirmation. */
  declareHandover(amount: number, branchId: string): Promise<CashHandover> {
    return this.http.post<CashHandover>('courier/handovers', { amount, branchId });
  }
}
