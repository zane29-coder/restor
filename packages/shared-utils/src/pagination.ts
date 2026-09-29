/**
 * Pagination helpers shared by the backend repositories and the clients.
 */

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type PaginationMeta,
  type PaginationQuery,
  type Paginated,
} from '@restor/shared-types';

export interface NormalizedPagination {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

/**
 * Clamps client-supplied paging into a safe range.
 *
 * An unbounded `limit` is a denial-of-service vector on an orders table, so the
 * cap is enforced server-side rather than trusted from the query string.
 */
export function normalizePagination(query: PaginationQuery = {}): NormalizedPagination {
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const requested = Math.floor(Number(query.limit) || DEFAULT_PAGE_SIZE);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, requested));

  return { page, limit, skip: (page - 1) * limit, take: limit };
}

export function buildPaginationMeta(
  total: number,
  { page, limit }: Pick<NormalizedPagination, 'page' | 'limit'>,
): PaginationMeta {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

export function paginated<T>(
  items: T[],
  total: number,
  pagination: Pick<NormalizedPagination, 'page' | 'limit'>,
): Paginated<T> {
  return { items, pagination: buildPaginationMeta(total, pagination) };
}
