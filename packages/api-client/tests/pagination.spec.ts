import { HttpClient } from '../src/http-client';

/**
 * The envelope contract for list endpoints (TZ §43).
 *
 * The server does NOT send `{ items, pagination }`. `ResponseInterceptor`
 * splits a page in two: the rows go into `data` and the counters into
 * `meta.pagination`. A client that simply reads `data` therefore ends up with
 * a bare array while TypeScript believes it holds `Paginated<T>` — `.items` is
 * `undefined`, `?? []` swallows it, and every list in the UI renders empty
 * with no error anywhere. That is the bug these tests exist to prevent.
 */

function clientWith(respond: (url: string) => unknown): HttpClient {
  const fetchImpl = jest.fn(async (url: string) =>
    new Response(JSON.stringify(respond(url)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );

  return new HttpClient({
    baseUrl: 'https://example.test/api/v1',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
}

const PAGE = {
  page: 2,
  limit: 20,
  total: 41,
  totalPages: 3,
  hasNext: true,
  hasPrev: true,
};

describe('getPaginated', () => {
  it('rebuilds items and pagination from the split envelope', async () => {
    const http = clientWith(() => ({
      success: true,
      data: [{ id: 'a' }, { id: 'b' }],
      error: null,
      meta: { requestId: 'req-1', timestamp: '2026-09-29T00:00:00.000Z', pagination: PAGE },
    }));

    const result = await http.getPaginated<{ id: string }>('orders');

    expect(result.items).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(result.pagination).toEqual(PAGE);
  });

  it('gives an empty page rather than undefined when there are no rows', async () => {
    const http = clientWith(() => ({
      success: true,
      data: [],
      error: null,
      meta: { pagination: { ...PAGE, page: 1, total: 0, totalPages: 0, hasNext: false, hasPrev: false } },
    }));

    const result = await http.getPaginated<{ id: string }>('orders');

    expect(result.items).toEqual([]);
    expect(result.pagination.total).toBe(0);
  });

  it('synthesises counters when the server sends no pagination block', async () => {
    // Some endpoints return a plain array. Callers still get a usable page
    // instead of `undefined` counters reaching the UI.
    const http = clientWith(() => ({
      success: true,
      data: [{ id: 'a' }],
      error: null,
      meta: { requestId: 'req-2' },
    }));

    const result = await http.getPaginated<{ id: string }>('couriers/live');

    expect(result.items).toEqual([{ id: 'a' }]);
    expect(result.pagination).toEqual({
      page: 1,
      limit: 1,
      total: 1,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    });
  });

  it('is not what a plain get() returns — the regression this guards', async () => {
    const envelope = {
      success: true,
      data: [{ id: 'a' }],
      error: null,
      meta: { pagination: PAGE },
    };
    const http = clientWith(() => envelope);

    // What the old code did. It type-asserts to the shape the caller expected
    // and shows that `.items` was never there.
    const wrong = (await http.get('orders')) as { items?: unknown[] };
    expect(Array.isArray(wrong)).toBe(true);
    expect(wrong.items).toBeUndefined();
  });
});
