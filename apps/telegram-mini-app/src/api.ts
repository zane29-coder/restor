import { MemoryTokenStore, createRestorClient } from '@restor/api-client';
import { getWebApp } from './telegram';

/**
 * Which restaurant this Mini App belongs to.
 *
 * `start_param` is how a deep link carries it (`t.me/bot/app?startapp=demo`);
 * `VITE_TENANT_SLUG` pins it for a tenant that runs its own bot.
 */
export function resolveTenantSlug(): string {
  const fromStartParam = getWebApp()?.initDataUnsafe.start_param;
  if (fromStartParam) return fromStartParam;

  const fromQuery = new URLSearchParams(window.location.search).get('tenant');
  if (fromQuery) return fromQuery;

  return import.meta.env.VITE_TENANT_SLUG ?? 'demo';
}

export const tenantSlug = resolveTenantSlug();

/**
 * In-memory token store on purpose.
 *
 * A Mini App session lasts as long as the sheet is open, and Telegram may host
 * several accounts on one device — persisting a token to `localStorage` risks
 * handing one Telegram user another's session.
 */
export const api = createRestorClient({
  baseUrl: import.meta.env.VITE_API_URL ?? '/api/v1',
  tokenStore: new MemoryTokenStore(),
  defaultHeaders: { 'X-Tenant-Slug': tenantSlug },
});
