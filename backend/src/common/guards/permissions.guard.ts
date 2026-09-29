import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, SystemRole, type Permission } from '@restor/shared-types';
import type { Request } from 'express';
import {
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
  PERMISSIONS_MODE_KEY,
  SUPER_ADMIN_KEY,
} from '../decorators';
import { AppException } from '../errors/app-exception';
import type { RequestContext } from '../context/request-context';

/**
 * Authorises against PERMISSIONS, never against role names (TZ §5).
 *
 * That is what makes a tenant's custom "Senior Cashier" role behave exactly
 * like a built-in one, and it means granting a new capability is a data change
 * rather than a code change.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const controller = context.getClass();

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      handler,
      controller,
    ]);
    const superAdminOnly = this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN_KEY, [
      handler,
      controller,
    ]);

    if (!required?.length && !superAdminOnly) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const ctx = request.restorContext as RequestContext | undefined;

    if (!ctx?.userId) {
      const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        handler,
        controller,
      ]);
      // A public route decorated with permissions means "anonymous is fine,
      // but a signed-in user still needs the right"; without a user there is
      // nothing to check.
      if (isPublic) return true;
      throw AppException.unauthorized();
    }

    const isSuperAdmin = ctx.bypassTenantScope && !ctx.tenantId;

    if (superAdminOnly && !isSuperAdmin) {
      throw AppException.forbidden('This endpoint is restricted to platform administrators');
    }

    // Super admin short-circuits, so a newly added permission never has to be
    // back-filled into the platform role.
    if (isSuperAdmin) return true;

    if (!required?.length) return true;

    const mode = this.reflector.getAllAndOverride<'any' | 'all'>(PERMISSIONS_MODE_KEY, [
      handler,
      controller,
    ]);

    const granted = ctx.permissions;
    const allowed =
      mode === 'any'
        ? required.some((permission) => granted.includes(permission))
        : required.every((permission) => granted.includes(permission));

    if (!allowed) {
      const missing = required.filter((permission) => !granted.includes(permission));
      throw new AppException(
        ErrorCode.PERMISSION_DENIED,
        `Missing permission: ${missing.join(', ')}`,
        403,
      );
    }

    return true;
  }
}

/** Shared helper: does this context hold the platform role? */
export function isPlatformAdmin(ctx: RequestContext, roles: string[] = []): boolean {
  return !ctx.tenantId && (ctx.bypassTenantScope || roles.includes(SystemRole.SUPER_ADMIN));
}
