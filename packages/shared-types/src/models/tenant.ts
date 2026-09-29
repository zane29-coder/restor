import type { BaseEntity } from '../api';
import type { Currency, SubscriptionStatus, TenantStatus } from '../enums';

/** A single restaurant company on the platform (TZ §4). */
export interface Tenant extends BaseEntity {
  name: string;
  /** URL-safe identifier used by `restor.uz/r/{slug}` (TZ §47). */
  slug: string;
  status: TenantStatus;
  legalName: string | null;
  phone: string | null;
  email: string | null;
  currency: Currency;
  timezone: string;
  locale: string;
  branding: TenantBranding;
  blockedAt: string | null;
  blockReason: string | null;
}

/** White-label settings (TZ §49). */
export interface TenantBranding {
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  /** Custom ordering domain, e.g. `order.customer-domain.uz`. */
  domain: string | null;
  companyName: string | null;
  /**
   * Whether the tenant runs its own Telegram bot. The token itself is never
   * exposed over the API — only whether one is configured.
   */
  hasCustomBot: boolean;
}

/** A tariff a tenant can subscribe to (TZ §6). */
export interface Plan extends BaseEntity {
  code: string;
  name: string;
  description: string | null;
  price: number;
  currency: Currency;
  /** Billing period length in days (30 = monthly, 365 = yearly). */
  periodDays: number;
  limits: PlanLimits;
  isActive: boolean;
  sortOrder: number;
}

/** `null` means "unlimited" for that dimension. */
export interface PlanLimits {
  maxBranches: number | null;
  maxEmployees: number | null;
  maxPosTerminals: number | null;
  maxBots: number | null;
  maxStorageMb: number | null;
}

export interface Subscription extends BaseEntity {
  tenantId: string;
  planId: string;
  plan?: Plan;
  status: SubscriptionStatus;
  startsAt: string;
  endsAt: string;
  cancelledAt: string | null;
  /**
   * Limits frozen at purchase time. A later change to the plan's limits does
   * not silently re-price or re-limit an active subscription.
   */
  limits: PlanLimits;
}

/** Current usage against {@link PlanLimits}, for the super-admin screens. */
export interface SubscriptionUsage {
  branches: number;
  employees: number;
  posTerminals: number;
  bots: number;
  storageMb: number;
}

/** Super Admin dashboard figures (TZ §6). */
export interface PlatformStats {
  totalCompanies: number;
  activeCompanies: number;
  blockedCompanies: number;
  totalBranches: number;
  totalOrders: number;
  /** Gross merchandise value across every tenant, in minor units. */
  gmv: number;
  monthlyRevenue: number;
  activeSubscriptions: number;
  expiredSubscriptions: number;
}
