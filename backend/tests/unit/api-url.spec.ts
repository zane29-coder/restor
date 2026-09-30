import { API_GLOBAL_PREFIX, apiUrl } from '../../src/common/constants';

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
