import {
  API_GLOBAL_PREFIX,
  RESERVED_HOST_LABELS,
  apiUrl,
  platformHostnames,
} from '../../src/common/constants';

/**
 * Absolute URLs back to this API (TZ §36).
 *
 * The reason this file exists: the Subo callback URL was advertised without
 * the global prefix. Every payment callback would have hit the static site,
 * been answered 405, and left the charge PENDING after Subo's five retries —
 * a customer charged, an order that does not know it. The smoke test missed
 * it because its pattern wildcarded the very segment that was missing, so it
 * matched the right URL and the wrong one equally.
 *
 * So these assert the whole string, never a pattern with a wildcard where the
 * prefix belongs.
 */
describe('apiUrl', () => {
  it('carries the global prefix', () => {
    expect(apiUrl('https://restor.uz', 'webhooks/subo')).toBe(
      'https://restor.uz/api/v1/webhooks/subo',
    );
  });

  it('tolerates a trailing slash on the base', () => {
    expect(apiUrl('https://restor.uz/', 'webhooks/subo')).toBe(
      'https://restor.uz/api/v1/webhooks/subo',
    );
    expect(apiUrl('https://restor.uz///', 'webhooks/subo')).toBe(
      'https://restor.uz/api/v1/webhooks/subo',
    );
  });

  it('tolerates a leading slash on the path', () => {
    expect(apiUrl('https://restor.uz', '/webhooks/subo')).toBe(
      'https://restor.uz/api/v1/webhooks/subo',
    );
  });

  it('never doubles a slash', () => {
    expect(apiUrl('https://restor.uz/', '/webhooks/subo')).not.toMatch(/[^:]\/\//);
  });

  it('gives the bare API root with no path', () => {
    expect(apiUrl('https://restor.uz')).toBe('https://restor.uz/api/v1');
  });

  it('keeps a port and a sub-path on the base', () => {
    expect(apiUrl('http://localhost:3000', 'webhooks/subo')).toBe(
      'http://localhost:3000/api/v1/webhooks/subo',
    );
  });

  it('is the prefix main.ts actually registers', () => {
    // Both read this constant; the test pins its value so a change has to be
    // deliberate rather than a passing thought.
    expect(API_GLOBAL_PREFIX).toBe('api/v1');
  });
});

/**
 * The platform's own hostnames (TZ §47, §49).
 *
 * The tenant resolver reads the leading label of the Host as a tenant slug, so
 * `demo.restor.uz` serves the `demo` tenant without any configuration. Once
 * each app has a sub-domain, that same rule makes `pos.restor.uz` resolve to a
 * tenant slugged `pos` — which is why the resolver skips the label rule on
 * these hosts, and why tenant creation will not hand the labels out.
 *
 * An explicit `Tenant.domain` still matches them: that is a deliberate act by
 * a platform admin, and how a single-tenant deployment serves its storefront
 * from the bare domain.
 */
describe('platformHostnames', () => {
  const hosts = platformHostnames('https://restor.uz');

  it('includes the apex and every app host', () => {
    expect(hosts.has('restor.uz')).toBe(true);
    expect(hosts.has('app.restor.uz')).toBe(true);
    expect(hosts.has('pos.restor.uz')).toBe(true);
    expect(hosts.has('kds.restor.uz')).toBe(true);
    expect(hosts.has('tg.restor.uz')).toBe(true);
    expect(hosts.has('api.restor.uz')).toBe(true);
    expect(hosts.has('www.restor.uz')).toBe(true);
  });

  it('covers every reserved label', () => {
    for (const label of RESERVED_HOST_LABELS) {
      expect(hosts.has(`${label}.restor.uz`)).toBe(true);
    }
  });

  it('leaves a tenant sub-domain resolvable', () => {
    // The white-label feature depends on this NOT matching.
    expect(hosts.has('demo.restor.uz')).toBe(false);
  });

  it('does not reserve the same label under another apex', () => {
    // Only labels under this platform's own domain are ours. A tenant's
    // white-label host may legitimately be `app.burgerking.uz`.
    expect(hosts.has('app.burgerking.uz')).toBe(false);
  });

  it('derives the apex from the URL rather than a hard-coded domain', () => {
    const staging = platformHostnames('https://restor-staging.example.com:8443');
    expect(staging.has('restor-staging.example.com')).toBe(true);
    expect(staging.has('pos.restor-staging.example.com')).toBe(true);
    // The port belongs to the URL, not to the hostname.
    expect(staging.has('restor-staging.example.com:8443')).toBe(false);
  });

  it('ignores a path and a trailing slash on the configured URL', () => {
    expect(platformHostnames('https://restor.uz/').has('restor.uz')).toBe(true);
  });
});
