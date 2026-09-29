import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode, SystemRole, type JwtAccessPayload } from '@restor/shared-types';
import type { Request } from 'express';
import { AppConfig } from '../../config/configuration';
import { IS_PUBLIC_KEY } from '../decorators';
import { AppException } from '../errors/app-exception';
import { patchContext } from '../context/request-context';

/**
 * Verifies the bearer token and populates the request context (TZ §52).
 *
 * Registered globally, so routes are protected unless explicitly marked
 * `@Public()`. The tenant is taken from the token payload and from nowhere
 * else — a `tenantId` in the body, query or a header is ignored.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);

    // A public route still reads the token when one is present: the customer
    // storefront is public, but a signed-in customer should see their own
    // addresses and order history.
    if (!token) {
      if (isPublic) return true;
      throw AppException.unauthorized('Authentication required');
    }

    let payload: JwtAccessPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtAccessPayload>(token, {
        secret: this.config.auth.accessSecret,
      });
    } catch (error) {
      if (isPublic) return true;

      const expired = error instanceof Error && error.name === 'TokenExpiredError';
      throw AppException.unauthorized(
        expired ? 'Access token has expired' : 'Invalid access token',
        expired ? ErrorCode.TOKEN_EXPIRED : ErrorCode.TOKEN_INVALID,
      );
    }

    if (payload.typ !== 'access') {
      // A refresh token must never be accepted as an access token.
      if (isPublic) return true;
      throw AppException.unauthorized('Wrong token type', ErrorCode.TOKEN_INVALID);
    }

    const isSuperAdmin = payload.roles.includes(SystemRole.SUPER_ADMIN);

    patchContext({
      userId: payload.sub,
      tenantId: payload.tenantId ?? undefined,
      // Platform staff legitimately read across tenants; everyone else is
      // pinned to the tenant in their token.
      bypassTenantScope: isSuperAdmin,
      branchIds: payload.branchIds ?? [],
      permissions: payload.permissions ?? [],
      courierId: payload.courierId,
    });

    return true;
  }
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header) return null;

  const [scheme, value] = header.split(' ');
  if (!value || scheme?.toLowerCase() !== 'bearer') return null;

  return value.trim() || null;
}
