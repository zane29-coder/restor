import { ErrorCode, type ApiError } from '@restor/shared-types';

/**
 * Every failure a caller sees is one of these — a 4xx body, a 5xx, a timeout or
 * a dropped connection. Callers switch on `code`, not on HTTP status or on
 * message text.
 */
export class RestorApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, string[]>;
  readonly requestId?: string;

  constructor(params: {
    code: string;
    message: string;
    status: number;
    details?: Record<string, string[]>;
    requestId?: string;
  }) {
    super(params.message);
    this.name = 'RestorApiError';
    this.code = params.code;
    this.status = params.status;
    this.details = params.details;
    this.requestId = params.requestId;
  }

  static fromApiError(error: ApiError, status: number, requestId?: string): RestorApiError {
    return new RestorApiError({
      code: error.code,
      message: error.message,
      status,
      details: error.details,
      requestId,
    });
  }

  /** The request never reached the server (offline, DNS, TLS). */
  static network(cause: unknown): RestorApiError {
    return new RestorApiError({
      code: 'NETWORK_ERROR',
      message: cause instanceof Error ? cause.message : 'Network request failed',
      status: 0,
    });
  }

  static timeout(ms: number): RestorApiError {
    return new RestorApiError({
      code: 'TIMEOUT',
      message: `Request timed out after ${ms}ms`,
      status: 0,
    });
  }

  /**
   * True when the request never completed, so the POS may safely replay it with
   * the same idempotency key (TZ §18).
   */
  get isNetworkFailure(): boolean {
    return this.status === 0;
  }

  get isUnauthorized(): boolean {
    return (
      this.status === 401 ||
      this.code === ErrorCode.UNAUTHORIZED ||
      this.code === ErrorCode.TOKEN_EXPIRED
    );
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** Validation failures carry per-field messages for the form to render. */
  get isValidation(): boolean {
    return this.code === ErrorCode.VALIDATION_ERROR;
  }

  /** Whether retrying the exact same request could plausibly succeed. */
  get isRetryable(): boolean {
    return this.isNetworkFailure || this.status === 429 || this.status >= 500;
  }
}
