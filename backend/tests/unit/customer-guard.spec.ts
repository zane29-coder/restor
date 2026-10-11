import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission } from '@restor/shared-types';
import { CustomerOnly, Public, RequirePermissions } from '../../src/common/decorators';
import type { RequestContext } from '../../src/common/context/request-context';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard';

/**
 * The boundary between storefront customers and staff.
 *
 * A Mini App token must reach the `/me` routes and public routes, and nothing
 * else — in particular not a staff route that declares no permission, which a
 * permissions-only check would wave through.
 */
class Routes {
  @CustomerOnly()
  me(): void {}

  @Public()
  menu(): void {}

  @Public()
  @RequirePermissions(Permission.ORDERS_CREATE)
  publicWithPermission(): void {}

  @RequirePermissions(Permission.ORDERS_VIEW)
  staffList(): void {}

  /** Like `/auth/me`: authenticated, but no permission declared. */
  staffNoPermission(): void {}
}

const customer: RequestContext = {
  requestId: 'r',
  customerId: 'c1',
  customerAccountId: 'a1',
  tenantId: 't1',
  bypassTenantScope: false,
  branchIds: [],
  permissions: [],
};

const staff: RequestContext = {
  requestId: 'r',
  userId: 'u1',
  tenantId: 't1',
  bypassTenantScope: false,
  branchIds: [],
  permissions: [Permission.ORDERS_VIEW],
};

const anonymous: RequestContext = {
  requestId: 'r',
  tenantId: 't1',
  bypassTenantScope: false,
  branchIds: [],
  permissions: [],
};

function contextFor(handler: keyof Routes, ctx: RequestContext): ExecutionContext {
  return {
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => ({ restorContext: ctx }) }),
  } as unknown as ExecutionContext;
}

const guard = new PermissionsGuard(new Reflector());
const run = (handler: keyof Routes, ctx: RequestContext) => () =>
  guard.canActivate(contextFor(handler, ctx));

describe('PermissionsGuard — customer sessions', () => {
  it('lets a customer reach their own routes', () => {
    expect(run('me', customer)()).toBe(true);
  });

  it('refuses a staff token on a customer route', () => {
    expect(run('me', staff)).toThrow(expect.objectContaining({ status: 403 }));
  });

  it('asks an anonymous caller to sign in on a customer route', () => {
    expect(run('me', anonymous)).toThrow(expect.objectContaining({ status: 401 }));
  });

  it('lets a customer read public routes', () => {
    expect(run('menu', customer)()).toBe(true);
  });

  it('treats a customer on a public route with permissions like an anonymous caller', () => {
    expect(run('publicWithPermission', customer)()).toBe(true);
  });

  it('refuses a customer on a permission-gated staff route', () => {
    expect(run('staffList', customer)).toThrow(expect.objectContaining({ status: 403 }));
  });

  it('refuses a customer on a staff route that declares no permission', () => {
    expect(run('staffNoPermission', customer)).toThrow(expect.objectContaining({ status: 403 }));
  });

  it('leaves staff behaviour unchanged', () => {
    expect(run('staffList', staff)()).toBe(true);
    expect(run('staffNoPermission', staff)()).toBe(true);
  });
});
