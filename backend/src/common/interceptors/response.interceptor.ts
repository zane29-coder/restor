import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { ApiSuccess, Paginated } from '@restor/shared-types';
import { getRequestId } from '../context/request-context';
import { RAW_RESPONSE_KEY } from '../decorators/raw-response.decorator';

/**
 * Wraps every handler result in the standard envelope (TZ §43).
 *
 * Handlers return plain data; this is the only place that knows about
 * `{ success, data, error }`, so the shape cannot drift between endpoints.
 *
 * A list handler that returns `{ items, pagination }` is unwrapped so the
 * array lands in `data` and the paging metadata in `meta.pagination` — the
 * client never has to reach through two levels for a list.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiSuccess<unknown>> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<unknown>> {
    // Webhooks and file downloads must answer in the provider's own format.
    const isRaw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    return next.handle().pipe(
      map((data) => {
        if (isRaw) return data as unknown as ApiSuccess<unknown>;

        const requestId = getRequestId();
        const timestamp = new Date().toISOString();

        if (isPaginated(data)) {
          return {
            success: true as const,
            data: data.items,
            error: null,
            meta: { requestId, timestamp, pagination: data.pagination },
          };
        }

        return {
          success: true as const,
          data: data ?? null,
          error: null,
          meta: { requestId, timestamp },
        };
      }),
    );
  }
}

function isPaginated(value: unknown): value is Paginated<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as Paginated<unknown>).items) &&
    typeof (value as Paginated<unknown>).pagination === 'object'
  );
}
