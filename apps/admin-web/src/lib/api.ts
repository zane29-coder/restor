import { LocalStorageTokenStore, createRestorClient } from '@restor/api-client';

/**
 * The app's single API client (TZ §45).
 *
 * Token refresh, the response envelope and error normalisation all live in
 * `@restor/api-client`; this file only wires in the parts that are specific to
 * the admin panel — where tokens are persisted and what happens on a 401.
 */

/** Same-origin in production (nginx proxies `/api`), proxied by Vite in dev. */
const baseUrl = import.meta.env.VITE_API_URL ?? '/api/v1';

let onUnauthorized: () => void = () => {
  // Default before the router mounts: a full reload lands on the login screen.
  window.location.href = '/login';
};

/** Lets the router replace the hard reload with a soft navigation. */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

export const api = createRestorClient({
  baseUrl,
  tokenStore: new LocalStorageTokenStore('restor.admin.tokens'),
  onUnauthorized: () => onUnauthorized(),
});

export { RestorApiError } from '@restor/api-client';
