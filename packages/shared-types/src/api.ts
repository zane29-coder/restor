/**
 * Envelope every RESTOR endpoint returns (TZ §43).
 *
 * The backend never returns a bare object: a response interceptor wraps every
 * successful handler result in {@link ApiSuccess} and an exception filter turns
 * every thrown error into {@link ApiFailure}. Clients can therefore branch on a
 * single `success` flag instead of guessing from the HTTP status.
 */

export interface ApiError {
  /** Stable, machine-readable code — see `ErrorCode`. Never localise this. */
  code: string;
  /** Human readable message, safe to surface to the end user. */
  message: string;
  /** Field-level validation problems, keyed by dotted field path. */
  details?: Record<string, string[]>;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  error: null;
  meta?: ResponseMeta;
}

export interface ApiFailure {
  success: false;
  data: null;
  error: ApiError;
  meta?: ResponseMeta;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface ResponseMeta {
  /** Correlates a response with the structured log line that produced it. */
  requestId?: string;
  timestamp?: string;
  pagination?: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/** Shape returned by list endpoints before the interceptor wraps it. */
export interface Paginated<T> {
  items: T[];
  pagination: PaginationMeta;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: SortOrder;
  search?: string;
}

export type SortOrder = 'asc' | 'desc';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Narrowing helper so clients get `data` typed without a manual cast. */
export function isApiSuccess<T>(response: ApiResponse<T>): response is ApiSuccess<T> {
  return response.success === true;
}

/** Common shape of every persisted record exposed over the API. */
export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/** Records that belong to exactly one tenant (TZ §4). */
export interface TenantScopedEntity extends BaseEntity {
  tenantId: string;
}
