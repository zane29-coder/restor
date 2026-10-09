import type {
  Paginated,
  PaginationQuery,
  Plan,
  PlatformStats,
  Subscription,
  SubscriptionUsage,
  TelegramConfig,
  Tenant,
  TenantStatus,
} from '@restor/shared-types';
import type { HttpClient } from '../http-client';

/**
 * Super-admin surface (TZ §6). Every route here requires a platform-level
 * permission, so a tenant user calling them gets 403.
 */
export class PlatformResource {
  constructor(private readonly http: HttpClient) {}

  stats(): Promise<PlatformStats> {
    return this.http.get<PlatformStats>('platform/stats');
  }

  listTenants(
    query?: PaginationQuery & { status?: TenantStatus },
  ): Promise<Paginated<Tenant>> {
    return this.http.getPaginated<Tenant>('platform/tenants', { query });
  }

  getTenant(id: string): Promise<Tenant> {
    return this.http.get<Tenant>(`platform/tenants/${id}`);
  }

  /** Creates the company together with its first owner account. */
  createTenant(payload: unknown): Promise<Tenant> {
    return this.http.post<Tenant>('platform/tenants', payload);
  }

  updateTenant(id: string, payload: unknown): Promise<Tenant> {
    return this.http.patch<Tenant>(`platform/tenants/${id}`, payload);
  }

  blockTenant(id: string, reason: string): Promise<Tenant> {
    return this.http.post<Tenant>(`platform/tenants/${id}/block`, { reason });
  }

  activateTenant(id: string): Promise<Tenant> {
    return this.http.post<Tenant>(`platform/tenants/${id}/activate`);
  }

  listPlans(): Promise<Plan[]> {
    return this.http.get<Plan[]>('platform/plans');
  }

  createPlan(payload: unknown): Promise<Plan> {
    return this.http.post<Plan>('platform/plans', payload);
  }

  assignSubscription(tenantId: string, payload: unknown): Promise<Subscription> {
    return this.http.post<Subscription>(
      `platform/tenants/${tenantId}/subscription`,
      payload,
    );
  }

  /** Current usage against the plan's limits, for the limits screen. */
  subscriptionUsage(tenantId: string): Promise<SubscriptionUsage> {
    return this.http.get<SubscriptionUsage>(`platform/tenants/${tenantId}/usage`);
  }

  /*
   * Integrations the platform wires up for a restaurant (TZ §6, §15). The
   * restaurant's own admin cannot set these — a bot token or a payment key
   * swapped by a tenant would redirect its orders or its money.
   */

  /** Attaches the restaurant's bot. The token is verified, then encrypted. */
  saveTenantTelegram(tenantId: string, payload: unknown): Promise<TelegramConfig> {
    return this.http.put<TelegramConfig>(`platform/tenants/${tenantId}/telegram`, payload);
  }

  /** Whether a payment key is on file — the key itself is never returned. */
  tenantPaymentProvider(tenantId: string): Promise<PaymentProviderView> {
    return this.http.get<PaymentProviderView>(`platform/tenants/${tenantId}/payment-provider`);
  }

  saveTenantPaymentProvider(
    tenantId: string,
    payload: unknown,
  ): Promise<PaymentProviderView> {
    return this.http.put<PaymentProviderView>(
      `platform/tenants/${tenantId}/payment-provider`,
      payload,
    );
  }
}

/** Mirrors the backend's `SuboConfigView`; deliberately holds no key. */
export interface PaymentProviderView {
  provider: string;
  hasKey: boolean;
  isSandbox: boolean;
  isActive: boolean;
  callbackUrl: string;
}
