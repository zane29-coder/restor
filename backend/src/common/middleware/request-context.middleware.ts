import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithContext, type RequestContext } from '../context/request-context';

declare module 'express-serve-static-core' {
  interface Request {
    restorContext: RequestContext;
  }
}

/**
 * Establishes the per-request context (TZ §59).
 *
 * Runs before the guards, so the context exists by the time anything can query
 * the database. It starts with NO tenant and NO bypass — the deliberately
 * unsafe-to-query state — and the auth guard fills in identity once the token
 * is verified. A route that somehow reaches Prisma before authentication
 * therefore fails closed.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // Honour an upstream id so a trace spans the proxy and the API.
    const incoming = req.headers['x-request-id'];
    const requestId =
      (Array.isArray(incoming) ? incoming[0] : incoming)?.slice(0, 64) || randomUUID();

    const context: RequestContext = {
      requestId,
      bypassTenantScope: false,
      branchIds: [],
      permissions: [],
      ip: req.ip,
      userAgent: req.headers['user-agent']?.slice(0, 500),
    };

    req.restorContext = context;
    res.setHeader('x-request-id', requestId);

    runWithContext(context, () => next());
  }
}
