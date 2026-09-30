import type {
  CashRegister,
  CashShift,
  CashTransaction,
  CloseShiftRequest,
  OpenShiftRequest,
  Paginated,
  PaginationQuery,
  ShiftSummary,
} from '@restor/shared-types';
import type { HttpClient } from '../http-client';

/** Till and shift management (TZ §19). */
export class CashResource {
  constructor(private readonly http: HttpClient) {}

  registers(branchId?: string): Promise<CashRegister[]> {
    return this.http.get<CashRegister[]>('cash/registers', { query: { branchId } });
  }

  createRegister(payload: {
    branchId: string;
    name: string;
    deviceId?: string | null;
  }): Promise<CashRegister> {
    return this.http.post<CashRegister>('cash/registers', payload);
  }

  /**
   * The shift currently open at this branch, if any.
   *
   * Scoped by branch rather than terminal: a cashier who moves to the second
   * till mid-shift is still working the same shift, and asking by device id
   * would hand them a second one.
   */
  currentShift(branchId: string): Promise<CashShift | null> {
    return this.http.get<CashShift | null>('cash/shifts/current', {
      query: { branchId },
    });
  }

  getShift(shiftId: string): Promise<CashShift> {
    return this.http.get<CashShift>(`cash/shifts/${shiftId}`);
  }

  openShift(payload: OpenShiftRequest): Promise<CashShift> {
    return this.http.post<CashShift>('cash/shifts/open', payload);
  }

  /** Totals to show the cashier before they confirm the count. */
  shiftSummary(shiftId: string): Promise<ShiftSummary> {
    return this.http.get<ShiftSummary>(`cash/shifts/${shiftId}/summary`);
  }

  closeShift(shiftId: string, payload: CloseShiftRequest): Promise<CashShift> {
    return this.http.post<CashShift>(`cash/shifts/${shiftId}/close`, payload);
  }

  listShifts(
    query?: PaginationQuery & { branchId?: string; cashRegisterId?: string },
  ): Promise<Paginated<CashShift>> {
    return this.http.getPaginated<CashShift>('cash/shifts', { query });
  }

  listTransactions(
    shiftId: string,
    query?: PaginationQuery,
  ): Promise<Paginated<CashTransaction>> {
    return this.http.getPaginated<CashTransaction>(`cash/shifts/${shiftId}/transactions`, {
      query,
    });
  }

  /** Manual cash in/out during a shift. Only those two types are accepted. */
  addTransaction(
    shiftId: string,
    payload: { type: 'CASH_IN' | 'CASH_OUT'; amount: number; comment?: string },
  ): Promise<CashTransaction> {
    return this.http.post<CashTransaction>(`cash/shifts/${shiftId}/transactions`, payload);
  }
}

/**
 * POS-specific endpoints, including the offline sync batch.
 */
export class PosResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Pushes orders queued while the terminal was offline (TZ §18).
   *
   * Each entry carries its own `clientUuid`; the backend de-duplicates on it, so
   * replaying the same batch is safe and returns the same server ids.
   */
  syncOrders(orders: unknown[]): Promise<
    Array<{ clientUuid: string; orderId: string; status: 'created' | 'duplicate' | 'failed'; error?: string }>
  > {
    return this.http.post('pos/sync/orders', { orders });
  }

  /** Menu + branch config snapshot the terminal caches for offline operation. */
  bootstrap(branchId: string): Promise<unknown> {
    return this.http.get('pos/bootstrap', { query: { branchId } });
  }
}
