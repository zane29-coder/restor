import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@restor/shared-types';
import type { RequestContext } from '../context/request-context';

/* -------------------------------------------------------------------------- */
/* Route metadata                                                             */
/* -------------------------------------------------------------------------- */

export const IS_PUBLIC_KEY = 'restor:isPublic';

/**
 * Marks a route as reachable without a token.
 *
 * Authentication is opt-OUT, not opt-in: the JWT guard is registered globally,
 * so forgetting a decorator leaves a route protected rather than open.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'restor:permissions';
export const PERMISSIONS_MODE_KEY = 'restor:permissionsMode';

/** Requires EVERY listed permission. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Requires AT LEAST ONE of the listed permissions. */
export function RequireAnyPermission(...permissions: Permission[]) {
  return (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    SetMetadata(PERMISSIONS_KEY, permissions)(target, key!, descriptor!);
    SetMetadata(PERMISSIONS_MODE_KEY, 'any')(target, key!, descriptor!);
  };
}

export const SUPER_ADMIN_KEY = 'restor:superAdminOnly';

/** Restricts a route to platform staff (TZ §6). */
export const SuperAdminOnly = () => SetMetadata(SUPER_ADMIN_KEY, true);

/* -------------------------------------------------------------------------- */
/* Param decorators                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The authenticated caller's context.
 *
 * Note what this is NOT: a tenant id read from the request. Scope always comes
 * from the verified token (TZ §52).
 */
export const Ctx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext =>
    ctx.switchToHttp().getRequest().restorContext,
);

/** The authenticated user's id. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const context = ctx.switchToHttp().getRequest().restorContext as RequestContext;
  return context.userId!;
});

/** The tenant every query in this request is scoped to. */
export const TenantId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const context = ctx.switchToHttp().getRequest().restorContext as RequestContext;
  return context.tenantId!;
});

export { RawResponse, RAW_RESPONSE_KEY } from './raw-response.decorator';
