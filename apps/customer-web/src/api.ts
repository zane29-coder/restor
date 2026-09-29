import { LocalStorageTokenStore, createRestorClient } from '@restor/api-client';

/**
 * Resolves which restaurant this page belongs to (TZ §47).
 *
 * Supported shapes:
 *   restor.uz/r/demo          → slug from the path
 *   order.demo.uz             → the tenant's white-label domain, resolved
 *                               server-side from the Host header
 *   ?tenant=demo              → escape hatch for local development
 *
 * The slug is sent as `X-Tenant-Slug`; the backend looks the id up itself and
 * never trusts a tenant id from the client (TZ §52).
 */
export function resolveTenantSlug(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get('tenant');
  if (fromQuery) return fromQuery;

  const match = /^\/r\/([a-z0-9-]+)/i.exec(window.location.pathname);
  if (match?.[1]) return match[1];

  // No slug: the backend falls back to matching the Host against
  // `Tenant.domain`, which is how white-label domains work.
  return null;
}

const tenantSlug = resolveTenantSlug();

export const api = createRestorClient({
  baseUrl: import.meta.env.VITE_API_URL ?? '/api/v1',
  tokenStore: new LocalStorageTokenStore('restor.customer.tokens'),
  defaultHeaders: tenantSlug ? { 'X-Tenant-Slug': tenantSlug } : {},
});

export { tenantSlug };
