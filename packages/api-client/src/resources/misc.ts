import type {
  AuditLog,
  Customer,
  CustomerAddress,
  Paginated,
  PaginationQuery,
  PromoCode,
  Promotion,
  RestaurantTable,
  TelegramConfig,
  TelegramRoute,
  UpsertTelegramRouteRequest,
  ValidatePromoCodeRequest,
  ValidatePromoCodeResult,
  WaiterCall,
  WaiterCallType,
} from '@restor/shared-types';
import type { HttpClient } from '../http-client';

/** CRM (TZ §31, §32). */
export class CustomersResource {
  constructor(private readonly http: HttpClient) {}

  list(query?: PaginationQuery & { segment?: string }): Promise<Paginated<Customer>> {
    return this.http.getPaginated<Customer>('customers', { query });
  }

  get(id: string): Promise<Customer> {
    return this.http.get<Customer>(`customers/${id}`);
  }

  update(id: string, payload: Partial<Customer>): Promise<Customer> {
    return this.http.patch<Customer>(`customers/${id}`, payload);
  }

  /* --- The signed-in customer's own profile (mini app / customer web) --- */

  myProfile(): Promise<Customer> {
    return this.http.get<Customer>('me/profile');
  }

  myAddresses(): Promise<CustomerAddress[]> {
    return this.http.get<CustomerAddress[]>('me/addresses');
  }

  addAddress(payload: Omit<CustomerAddress, 'id' | 'customerId' | 'createdAt' | 'updatedAt'>): Promise<CustomerAddress> {
    return this.http.post<CustomerAddress>('me/addresses', payload);
  }

  deleteAddress(id: string): Promise<void> {
    return this.http.delete<void>(`me/addresses/${id}`);
  }
}

/** Promotions and promo codes (TZ §10, §34). */
export class MarketingResource {
  constructor(private readonly http: HttpClient) {}

  listPromotions(query?: PaginationQuery): Promise<Paginated<Promotion>> {
    return this.http.getPaginated<Promotion>('promotions', { query });
  }

  createPromotion(payload: unknown): Promise<Promotion> {
    return this.http.post<Promotion>('promotions', payload);
  }

  updatePromotion(id: string, payload: unknown): Promise<Promotion> {
    return this.http.patch<Promotion>(`promotions/${id}`, payload);
  }

  listPromoCodes(query?: PaginationQuery): Promise<Paginated<PromoCode>> {
    return this.http.getPaginated<PromoCode>('promo-codes', { query });
  }

  createPromoCode(payload: unknown): Promise<PromoCode> {
    return this.http.post<PromoCode>('promo-codes', payload);
  }

  /** Checks a code against a cart before the order is placed. */
  validatePromoCode(payload: ValidatePromoCodeRequest): Promise<ValidatePromoCodeResult> {
    return this.http.post<ValidatePromoCodeResult>('promo-codes/validate', payload);
  }
}

/** Telegram group and topic routing (TZ §15). */
export class TelegramResource {
  constructor(private readonly http: HttpClient) {}

  getConfig(branchId?: string): Promise<TelegramConfig | null> {
    return this.http.get<TelegramConfig | null>('telegram/config', { query: { branchId } });
  }

  saveConfig(payload: unknown): Promise<TelegramConfig> {
    return this.http.put<TelegramConfig>('telegram/config', payload);
  }

  listRoutes(branchId?: string): Promise<TelegramRoute[]> {
    return this.http.get<TelegramRoute[]>('telegram/routes', { query: { branchId } });
  }

  upsertRoute(payload: UpsertTelegramRouteRequest): Promise<TelegramRoute> {
    return this.http.put<TelegramRoute>('telegram/routes', payload);
  }

  deleteRoute(id: string): Promise<void> {
    return this.http.delete<void>(`telegram/routes/${id}`);
  }

  /** Sends a probe message so the admin can confirm the chat/topic is right. */
  testRoute(payload: { chatId: string; topicId?: number | null }): Promise<{ ok: boolean; message: string }> {
    return this.http.post<{ ok: boolean; message: string }>('telegram/routes/test', payload);
  }
}

/** QR tables and waiter calls (TZ §29, §30). */
export class TablesResource {
  constructor(private readonly http: HttpClient) {}

  list(branchId?: string): Promise<RestaurantTable[]> {
    return this.http.get<RestaurantTable[]>('tables', { query: { branchId } });
  }

  create(payload: unknown): Promise<RestaurantTable> {
    return this.http.post<RestaurantTable>('tables', payload);
  }

  /** Issues a new QR token, invalidating printed codes for that table. */
  rotateQr(id: string): Promise<RestaurantTable> {
    return this.http.post<RestaurantTable>(`tables/${id}/rotate-qr`);
  }

  /** Public: resolves a scanned QR token to its table and branch. */
  resolveQr(token: string): Promise<{ table: RestaurantTable; branchId: string }> {
    return this.http.get<{ table: RestaurantTable; branchId: string }>(`tables/qr/${token}`, {
      skipAuth: true,
    });
  }

  /** Public: guest pressing "Call waiter" / "Request bill". */
  call(token: string, type: WaiterCallType): Promise<WaiterCall> {
    return this.http.post<WaiterCall>(`tables/qr/${token}/call`, { type }, { skipAuth: true });
  }

  pendingCalls(branchId: string): Promise<WaiterCall[]> {
    return this.http.get<WaiterCall[]>('waiter-calls', { query: { branchId, status: 'PENDING' } });
  }

  resolveCall(id: string): Promise<WaiterCall> {
    return this.http.post<WaiterCall>(`waiter-calls/${id}/resolve`);
  }
}

/** Audit log (TZ §37). */
export class AuditResource {
  constructor(private readonly http: HttpClient) {}

  list(
    query?: PaginationQuery & {
      userId?: string;
      action?: string;
      entity?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ): Promise<Paginated<AuditLog>> {
    return this.http.getPaginated<AuditLog>('audit', { query });
  }
}
