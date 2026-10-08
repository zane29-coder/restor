/**
 * The prefix every route is served under.
 *
 * Exported rather than written inline in `main.ts`, because anything that
 * builds an absolute URL back to this API has to agree with it. It did not
 * once: the Subo callback URL was advertised without the prefix, so every
 * payment callback would have hit the static site, returned 405, and left the
 * charge PENDING until someone reconciled it by hand.
 */
export const API_GLOBAL_PREFIX = 'api/v1';

/** `https://host` + this = the base every client and webhook should call. */
export function apiUrl(baseUrl: string, path = ''): string {
  const root = baseUrl.replace(/\/+$/, '');
  const suffix = path ? `/${path.replace(/^\/+/, '')}` : '';
  return `${root}/${API_GLOBAL_PREFIX}${suffix}`;
}

/**
 * Sub-domain labels the platform serves itself — one app each, see
 * `infrastructure/nginx/host/restor.conf`.
 *
 * They matter because a tenant reaches its storefront at
 * `{slug}.restor.uz` (TZ §49): a tenant slugged `pos` would collide with the
 * POS terminal's own host. Two places read this list — the tenant resolver,
 * which will not read the leading label of one of these hosts as a slug, and
 * tenant creation, which never hands one out as a slug in the first place.
 */
export const RESERVED_HOST_LABELS = [
  'www',
  'api',
  'app',
  'admin',
  'pos',
  'kds',
  'tg',
  'courier',
  // Not served today, but a tenant should not be able to claim them either.
  'static',
  'cdn',
  'mail',
] as const;

/**
 * Every hostname this deployment serves itself, derived from the storefront's
 * public URL.
 *
 * Derived rather than listed so a deployment on another domain — or a staging
 * one — needs no code change: `CUSTOMER_WEB_URL=https://restor.uz` yields
 * `restor.uz` plus `api.restor.uz`, `app.restor.uz` and the rest.
 *
 * Note what this is NOT: a check on the leading label alone. A tenant's
 * white-label domain may legitimately be `app.burgerking.uz`, and only the
 * labels under THIS platform's apex are reserved.
 */
export function platformHostnames(customerWebUrl: string): ReadonlySet<string> {
  const apex = new URL(customerWebUrl).hostname.toLowerCase();
  const hosts = new Set<string>([apex]);

  for (const label of RESERVED_HOST_LABELS) {
    hosts.add(`${label}.${apex}`);
  }

  return hosts;
}
