import type {
  Paginated,
  PaginationQuery,
  Plan,
  PlatformStats,
  Subscription,
  SubscriptionUsage,
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
}
