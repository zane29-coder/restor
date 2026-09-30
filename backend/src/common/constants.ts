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
