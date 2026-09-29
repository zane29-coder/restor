import {
  isApiSuccess,
  type ApiResponse,
  type Paginated,
  type ResponseMeta,
  type TokenPair,
} from '@restor/shared-types';
import { RestorApiError } from './errors';
import { MemoryTokenStore, toStoredTokens, type StoredTokens, type TokenStore } from './token-store';

export interface HttpClientOptions {
  /** Base URL including the version prefix, e.g. `https://api.restor.uz/api/v1`. */
  baseUrl: string;
  tokenStore?: TokenStore;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /**
   * Extra headers sent with every request — used for the tenant slug on public
   * storefront routes and for a POS terminal's device id.
   */
  defaultHeaders?: Record<string, string>;
  /** Called after a refresh fails, so the app can route back to the login screen. */
  onUnauthorized?: () => void;
  /** Called on every completed request; useful for a global loading indicator. */
  onResponse?: (info: { url: string; status: number; durationMs: number }) => void;
  /** Injected in tests; defaults to the platform `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Query params accepted by every request helper.
 *
 * Deliberately `object` rather than `Record<string, unknown>`: a declared
 * interface (like `OrderListQuery`) has no index signature, so it would not be
 * assignable to a `Record` and every call site would need a cast. The single
 * cast lives in {@link HttpClient.buildUrl} instead.
 */
export type QueryParams = object;

export interface RequestOptions {
  query?: QueryParams;
  headers?: Record<string, string>;
  /** Skips the Authorization header — for login, webhooks and public menus. */
  skipAuth?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Sent as `Idempotency-Key`; the POS uses it to make retries safe. */
  idempotencyKey?: string;
  /**
   * Receives the envelope's `meta` block on success.
   *
   * Internal: {@link HttpClient.getPaginated} uses it to recover the paging
   * counters, which the envelope keeps beside the rows rather than inside
   * them. Callers should use `getPaginated` rather than this directly.
   */
  onMeta?: (meta: ResponseMeta | undefined) => void;
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Refresh a few seconds early so a token cannot expire mid-flight. */
const REFRESH_SKEW_MS = 10_000;

/**
 * Transport shared by every RESTOR client (TZ §45).
 *
 * Responsibilities kept in one place so no app re-implements them:
 *  - attaches the bearer token and refreshes it exactly once per expiry,
 *  - unwraps the `{ success, data, error }` envelope,
 *  - turns every failure into a {@link RestorApiError},
 *  - enforces a timeout.
 */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly tokenStore: TokenStore;
  private readonly timeoutMs: number;
  private readonly defaultHeaders: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly onUnauthorized?: () => void;
  private readonly onResponse?: HttpClientOptions['onResponse'];

  /**
   * In-flight refresh. Concurrent 401s await this single promise instead of
   * each firing their own refresh — otherwise the first rotation invalidates
   * the token the others are still trying to use, and the user is logged out.
   */
  private refreshPromise: Promise<StoredTokens | null> | null = null;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.tokenStore = options.tokenStore ?? new MemoryTokenStore();
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.onUnauthorized = options.onUnauthorized;
    this.onResponse = options.onResponse;

    const platformFetch = options.fetchImpl ?? globalThis.fetch;
    if (!platformFetch) {
      throw new Error('No fetch implementation available — pass `fetchImpl`.');
    }
    // Bind so the browser's fetch keeps its `window` receiver.
    this.fetchImpl = platformFetch.bind(globalThis);
  }

  get tokens(): TokenStore {
    return this.tokenStore;
  }

  async setTokens(tokens: TokenPair): Promise<void> {
    await this.tokenStore.set(toStoredTokens(tokens));
  }

  async clearTokens(): Promise<void> {
    await this.tokenStore.clear();
  }

  async isAuthenticated(): Promise<boolean> {
    const stored = await this.tokenStore.get();
    return Boolean(stored?.refreshToken);
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }

  /**
   * A list endpoint, put back together into the shape its type promises.
   *
   * The server splits a page across the envelope (TZ §43): the rows go in
   * `data` and the paging counters in `meta.pagination`, so that a caller
   * reading a list never has to reach through two levels. The cost is that a
   * plain `get<Paginated<T>>` returns a bare array while TypeScript believes
   * it has `{ items, pagination }` — `.items` is then `undefined` at runtime
   * and every list silently renders empty. Rejoining the two halves here is
   * what makes the declared type true.
   */
  async getPaginated<T>(path: string, options?: RequestOptions): Promise<Paginated<T>> {
    let meta: ResponseMeta | undefined;

    const items = await this.request<T[]>('GET', path, undefined, {
      ...options,
      onMeta: (received) => {
        meta = received;
      },
    });

    const rows = items ?? [];
    return {
      items: rows,
      // A server that sent no pagination block still gets a usable page rather
      // than `undefined` counters leaking into the UI.
      pagination: meta?.pagination ?? {
        page: 1,
        limit: rows.length,
        total: rows.length,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    };
  }

  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, body, options);
  }

  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, body, options);
  }

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, undefined, options);
  }

  /** Multipart upload (product images) — the body must not be JSON-encoded. */
  async upload<T>(path: string, form: FormData, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, form, options);
  }

  private async request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
    isRetry = false,
  ): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const startedAt = Date.now();

    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.defaultHeaders,
      ...options.headers,
    };
    // Let the runtime set the multipart boundary itself.
    if (body !== undefined && !isFormData) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }
    if (!options.skipAuth) {
      const accessToken = await this.getValidAccessToken();
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    }

    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abortExternally = () => controller.abort();
    options.signal?.addEventListener('abort', abortExternally);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      if (controller.signal.aborted && !options.signal?.aborted) {
        throw RestorApiError.timeout(timeoutMs);
      }
      throw RestorApiError.network(cause);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abortExternally);
    }

    this.onResponse?.({ url, status: response.status, durationMs: Date.now() - startedAt });

    // A 401 on a non-auth call means the access token died: refresh once, then
    // replay. `isRetry` stops this from looping.
    if (response.status === 401 && !options.skipAuth && !isRetry) {
      const refreshed = await this.refreshTokens();
      if (refreshed) {
        return this.request<T>(method, path, body, options, true);
      }
      await this.clearTokens();
      this.onUnauthorized?.();
    }

    return this.unwrap<T>(response, options.onMeta);
  }

  private async unwrap<T>(
    response: Response,
    onMeta?: (meta: ResponseMeta | undefined) => void,
  ): Promise<T> {
    const requestId = response.headers.get('x-request-id') ?? undefined;

    if (response.status === 204) {
      return undefined as T;
    }

    let payload: ApiResponse<T>;
    try {
      payload = (await response.json()) as ApiResponse<T>;
    } catch {
      // A proxy or gateway returned HTML/plain text instead of our envelope.
      throw new RestorApiError({
        code: response.ok ? 'INVALID_RESPONSE' : 'HTTP_ERROR',
        message: `Unexpected non-JSON response (HTTP ${response.status})`,
        status: response.status,
        requestId,
      });
    }

    if (isApiSuccess(payload)) {
      onMeta?.(payload.meta);
      return payload.data;
    }

    throw RestorApiError.fromApiError(
      payload.error ?? { code: 'HTTP_ERROR', message: `HTTP ${response.status}` },
      response.status,
      payload.meta?.requestId ?? requestId,
    );
  }

  /** Returns a token that is still valid, refreshing proactively if needed. */
  private async getValidAccessToken(): Promise<string | null> {
    const stored = await this.tokenStore.get();
    if (!stored) return null;

    if (stored.expiresAt - REFRESH_SKEW_MS > Date.now()) {
      return stored.accessToken;
    }

    const refreshed = await this.refreshTokens();
    return refreshed?.accessToken ?? null;
  }

  /** Rotates the token pair; concurrent callers share one in-flight request. */
  private async refreshTokens(): Promise<StoredTokens | null> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async (): Promise<StoredTokens | null> => {
      const stored = await this.tokenStore.get();
      if (!stored?.refreshToken) return null;

      try {
        const response = await this.fetchImpl(`${this.baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ refreshToken: stored.refreshToken }),
        });

        if (!response.ok) return null;

        const payload = (await response.json()) as ApiResponse<TokenPair>;
        if (!isApiSuccess(payload)) return null;

        const next = toStoredTokens(payload.data);
        await this.tokenStore.set(next);
        return next;
      } catch {
        // Offline: keep the stored refresh token so a later attempt can work.
        return null;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private buildUrl(path: string, query?: QueryParams): string {
    const url = `${this.baseUrl}/${path.replace(/^\/+/, '')}`;
    if (!query) return url;

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        // Repeat the key so the backend receives a real array.
        for (const entry of value) {
          if (entry !== undefined && entry !== null) params.append(key, String(entry));
        }
      } else {
        params.append(key, String(value));
      }
    }

    const qs = params.toString();
    return qs ? `${url}?${qs}` : url;
  }
}
