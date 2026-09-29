import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TenantStatus } from '@restor/shared-types';
import { PrismaService } from '../../database/prisma.service';
import { patchContext, runUnscoped } from '../context/request-context';

interface CachedTenant {
  id: string;
  status: string;
  expiresAt: number;
}

/** How long a slug→tenant mapping is trusted without re-reading the database. */
const CACHE_TTL_MS = 60_000;

/**
 * Resolves the tenant for PUBLIC requests (TZ §47, §49).
 *
 * Staff requests carry a JWT and the tenant comes from it. The customer
 * storefront, the QR menu and the Mini App have no staff token, yet their
 * queries must still be tenant-scoped — otherwise the scoping extension
 * (correctly) refuses to run them.
 *
 * Resolution order, most explicit first:
 *   1. `X-Tenant-Slug` header — what the storefront SPA sends.
 *   2. `Host` matching a tenant's white-label `domain`.
 *   3. The leading label of the host, e.g. `demo.restor.uz` → `demo`.
 *
 * This only ever SETS a tenant when the context has none. It runs before the
 * auth guard, so a real token always wins: a client cannot widen its scope by
 * adding a header.
 *
 * Note what this is NOT: a `tenantId` accepted from the request. The client
 * supplies a public slug or hostname, and the id is looked up server-side
 * (TZ §52).
 */
@Injectable()
export class TenantResolverMiddleware implements NestMiddleware {
  /**
   * Small in-process cache: without it every anonymous menu request would add
   * a tenant lookup. One minute is short enough that blocking a tenant takes
   * effect promptly and long enough to absorb a lunchtime rush.
   */
  private readonly cache = new Map<string, CachedTenant>();

  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const hint = this.extractHint(req);

    if (hint) {
      const tenant = await this.resolve(hint);

      // A blocked tenant's storefront must stop serving immediately; leaving
      // the context empty makes the query fail closed rather than serve it.
      if (tenant && tenant.status !== TenantStatus.BLOCKED && tenant.status !== TenantStatus.SUSPENDED) {
        patchContext({ tenantId: tenant.id });
      }
    }

    next();
  }

  /** The slug or hostname to look up, or `null` when there is nothing to go on. */
  private extractHint(req: Request): { kind: 'slug' | 'domain'; value: string } | null {
    const header = req.headers['x-tenant-slug'];
    const slug = (Array.isArray(header) ? header[0] : header)?.trim().toLowerCase();
    if (slug) return { kind: 'slug', value: slug.slice(0, 80) };

    const host = req.headers.host?.split(':')[0]?.toLowerCase();
    if (!host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;

    return { kind: 'domain', value: host };
  }

  private async resolve(hint: {
    kind: 'slug' | 'domain';
    value: string;
  }): Promise<{ id: string; status: string } | null> {
    const cacheKey = `${hint.kind}:${hint.value}`;
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return { id: cached.id, status: cached.status };
    }

    // Unscoped: this lookup is what ESTABLISHES the scope.
    const tenant = await runUnscoped(() =>
      this.prisma.db.tenant.findFirst({
        where:
          hint.kind === 'slug'
            ? { slug: hint.value, deletedAt: null }
            : {
                deletedAt: null,
                OR: [
                  { domain: hint.value },
                  // `demo.restor.uz` → slug `demo`, so a tenant gets a
                  // subdomain without configuring a custom domain.
                  { slug: hint.value.split('.')[0] ?? '' },
                ],
              },
        select: { id: true, status: true },
      }),
    );

    if (tenant) {
      this.cache.set(cacheKey, { ...tenant, expiresAt: Date.now() + CACHE_TTL_MS });
      // Bound the cache so a hostname-scanning bot cannot grow it without limit.
      if (this.cache.size > 500) {
        const oldest = this.cache.keys().next().value;
        if (oldest) this.cache.delete(oldest);
      }
    }

    return tenant;
  }
}
