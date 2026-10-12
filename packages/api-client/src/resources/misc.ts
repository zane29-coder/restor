import type {
  AuditLog,
  Customer,
  CustomerSegment,
  CustomerSummary,
  LoyaltyAccount,
  LoyaltyProgram,
  LoyaltyTransaction,
  Paginated,
  PaginationQuery,
  PromoCode,
  PromoCodeUsage,
  Promotion,
  RestaurantTable,
  TelegramBotStatus,
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

  list(
    query?: PaginationQuery & {
      search?: string;
      isBlocked?: boolean;
      segment?: CustomerSegment;
      sort?: 'recent' | 'spent' | 'orders';
    },
  ): Promise<Paginated<Customer>> {
    return this.http.getPaginated<Customer>('customers', { query });
  }

  /** Base size, returning share, lifetime value, points owed, segment sizes. */
  summary(): Promise<CustomerSummary> {
    return this.http.get<CustomerSummary>('customers/summary');
  }

  /** Includes addresses and loyalty standing; the list does not. */
  get(id: string): Promise<Customer> {
    return this.http.get<Customer>(`customers/${id}`);
  }

  update(id: string, payload: Partial<Customer>): Promise<Customer> {
    return this.http.patch<Customer>(`customers/${id}`, payload);
  }

  /** What a manager checks before a goodwill call. */
  orders(
    id: string,
    query?: PaginationQuery,
  ): Promise<
    Paginated<{
      id: string;
      displayNumber: string;
      status: string;
      total: number;
      createdAt: string;
    }>
  > {
    return this.http.getPaginated(`customers/${id}/orders`, { query });
  }

  /** Blocking keeps the history and the points — it stops them ordering. */
  block(id: string, reason?: string): Promise<Customer> {
    return this.http.post<Customer>(`customers/${id}/block`, { reason });
  }

  unblock(id: string): Promise<Customer> {
    return this.http.post<Customer>(`customers/${id}/unblock`);
  }

  /* ------------------------------ Loyalty --------------------------- */

  loyaltyProgram(): Promise<LoyaltyProgram> {
    return this.http.get<LoyaltyProgram>('loyalty/program');
  }

  updateLoyaltyProgram(payload: {
    isActive?: boolean;
    cashbackPercent?: number;
    pointValue?: number;
    maxRedeemPercent?: number;
    expiryDays?: number | null;
    referralBonus?: number;
  }): Promise<LoyaltyProgram> {
    return this.http.patch<LoyaltyProgram>('loyalty/program', payload);
  }

  loyaltyAccount(customerId: string): Promise<LoyaltyAccount> {
    return this.http.get<LoyaltyAccount>(`customers/${customerId}/loyalty`);
  }

  loyaltyTransactions(
    customerId: string,
    query?: PaginationQuery,
  ): Promise<Paginated<LoyaltyTransaction>> {
    return this.http.getPaginated<LoyaltyTransaction>(
      `customers/${customerId}/loyalty/transactions`,
      { query },
    );
  }

  /** The most this customer could pay with points on a bill of `total`. */
  loyaltyQuote(
    customerId: string,
    total: number,
  ): Promise<{ points: number; amount: number }> {
    return this.http.get(`customers/${customerId}/loyalty/quote`, { query: { total } });
  }

  // The signed-in customer's own profile and addresses live on `client.me`.
}

/** Promotions and promo codes (TZ §10, §34). */
export class MarketingResource {
  constructor(private readonly http: HttpClient) {}

  listPromotions(
    query?: PaginationQuery & { branchId?: string; isActive?: boolean; search?: string },
  ): Promise<Paginated<Promotion>> {
    return this.http.getPaginated<Promotion>('promotions', { query });
  }

  getPromotion(id: string): Promise<Promotion> {
    return this.http.get<Promotion>(`promotions/${id}`);
  }

  createPromotion(payload: unknown): Promise<Promotion> {
    return this.http.post<Promotion>('promotions', payload);
  }

  updatePromotion(id: string, payload: unknown): Promise<Promotion> {
    return this.http.patch<Promotion>(`promotions/${id}`, payload);
  }

  /** Soft delete: orders already priced with it still name it. */
  deletePromotion(id: string): Promise<void> {
    return this.http.delete<void>(`promotions/${id}`);
  }

  listPromoCodes(
    query?: PaginationQuery & { isActive?: boolean; search?: string },
  ): Promise<Paginated<PromoCode>> {
    return this.http.getPaginated<PromoCode>('promo-codes', { query });
  }

  getPromoCode(id: string): Promise<PromoCode> {
    return this.http.get<PromoCode>(`promo-codes/${id}`);
  }

  createPromoCode(payload: unknown): Promise<PromoCode> {
    return this.http.post<PromoCode>('promo-codes', payload);
  }

  /** The code itself is not patchable — customers already have it. */
  updatePromoCode(id: string, payload: unknown): Promise<PromoCode> {
    return this.http.patch<PromoCode>(`promo-codes/${id}`, payload);
  }

  deletePromoCode(id: string): Promise<void> {
    return this.http.delete<void>(`promo-codes/${id}`);
  }

  /** Who redeemed a code and for how much — the campaign's actual result. */
  listPromoCodeUsages(
    id: string,
    query?: PaginationQuery,
  ): Promise<Paginated<PromoCodeUsage>> {
    return this.http.getPaginated<PromoCodeUsage>(`promo-codes/${id}/usages`, { query });
  }

  /** Checks a code against a cart before the order is placed. */
  validatePromoCode(payload: ValidatePromoCodeRequest): Promise<ValidatePromoCodeResult> {
    return this.http.post<ValidatePromoCodeResult>('promo-codes/validate', payload);
  }
}

/** Telegram bot, group and topic routing (TZ §14, §15). */
export class TelegramResource {
  constructor(private readonly http: HttpClient) {}

  getConfig(branchId?: string): Promise<TelegramConfig | null> {
    return this.http.get<TelegramConfig | null>('telegram/config', { query: { branchId } });
  }

  /** Whether Telegram is actually delivering to this deployment. */
  getBotStatus(branchId?: string): Promise<TelegramBotStatus> {
    return this.http.get<TelegramBotStatus>('telegram/bot/status', { query: { branchId } });
  }

  /** Points the bot's webhook back at this deployment. */
  connectBot(branchId?: string): Promise<TelegramBotStatus> {
    return this.http.post<TelegramBotStatus>('telegram/bot/connect', undefined, {
      query: { branchId },
    });
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
/** What a guest sees after scanning, before they have ordered anything. */
export interface TableSession {
  tableId: string;
  tableNumber: string;
  tableName: string | null;
  branchId: string;
  branchName: string;
  tenantSlug: string;
  /** An order already open on this table, so a second scan rejoins it. */
  openOrderId: string | null;
  openOrderNumber: string | null;
}

export class TablesResource {
  constructor(private readonly http: HttpClient) {}

  list(branchId?: string): Promise<RestaurantTable[]> {
    return this.http.get<RestaurantTable[]>('tables', { query: { branchId } });
  }

  create(payload: {
    branchId: string;
    number: string;
    name?: string | null;
    seats?: number | null;
    zone?: string | null;
  }): Promise<RestaurantTable> {
    return this.http.post<RestaurantTable>('tables', payload);
  }

  update(
    id: string,
    payload: {
      number?: string;
      name?: string | null;
      seats?: number | null;
      zone?: string | null;
      isActive?: boolean;
    },
  ): Promise<RestaurantTable> {
    return this.http.patch<RestaurantTable>(`tables/${id}`, payload);
  }

  remove(id: string): Promise<void> {
    return this.http.delete<void>(`tables/${id}`);
  }

  /** Issues a new QR token, invalidating printed codes for that table. */
  rotateQr(id: string): Promise<RestaurantTable> {
    return this.http.post<RestaurantTable>(`tables/${id}/rotate-qr`);
  }

  /** Open calls, oldest first — the queue a waiter works. */
  listCalls(query?: { branchId?: string; status?: string }): Promise<WaiterCall[]> {
    return this.http.get<WaiterCall[]>('waiter-calls', { query });
  }

  acknowledgeCall(id: string): Promise<WaiterCall> {
    return this.http.post<WaiterCall>(`waiter-calls/${id}/acknowledge`);
  }

  resolveCall(id: string): Promise<WaiterCall> {
    return this.http.post<WaiterCall>(`waiter-calls/${id}/resolve`);
  }

  /**
   * Public: resolves a scanned QR token.
   *
   * `skipAuth` because a guest has no account — the token in the path is the
   * whole credential, and it reaches one table at one branch.
   */
  resolveQr(token: string): Promise<TableSession> {
    return this.http.get<TableSession>(`t/${token}`, { skipAuth: true });
  }

  /** Public: guest pressing "Call waiter" / "Request bill". */
  call(token: string, type: WaiterCallType): Promise<WaiterCall> {
    return this.http.post<WaiterCall>(`t/${token}/call`, { type }, { skipAuth: true });
  }

  /** Just the ones nobody has picked up yet. */
  pendingCalls(branchId: string): Promise<WaiterCall[]> {
    return this.http.get<WaiterCall[]>('waiter-calls', { query: { branchId, status: 'PENDING' } });
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
