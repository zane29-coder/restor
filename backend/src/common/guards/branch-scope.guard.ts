import { Injectable } from '@nestjs/common';
import { Permission } from '@restor/shared-types';
import { AppException } from '../errors/app-exception';
import { getContext } from '../context/request-context';

/**
 * Branch-level scoping (TZ §5 — roles may be scoped to a branch).
 *
 * Tenant scoping alone is not enough: a cashier at the Chilonzor branch should
 * not read the Yunusobod till. This is a service-layer helper rather than a
 * guard because most endpoints need the check *inside* a query (filtering a
 * list) rather than as an all-or-nothing gate on the route.
 */
@Injectable()
export class BranchScope {
  /**
   * Throws unless the caller may act on `branchId`.
   *
   * An empty `branchIds` in the context means "all branches of the tenant",
   * which is how owners and company admins are represented.
   */
  assertCanAccess(branchId: string): void {
    const ctx = getContext();
    if (!ctx || ctx.bypassTenantScope) return;
    if (ctx.branchIds.length === 0) return;

    if (!ctx.branchIds.includes(branchId)) {
      throw AppException.forbidden('You do not have access to this branch');
    }
  }

  /**
   * Returns the branch filter to merge into a list query.
   *
   * `undefined` means no restriction; otherwise it is a Prisma `in` filter.
   */
  filterFor(requestedBranchId?: string): { in: string[] } | string | undefined {
    const ctx = getContext();

    if (requestedBranchId) {
      this.assertCanAccess(requestedBranchId);
      return requestedBranchId;
    }

    if (!ctx || ctx.bypassTenantScope || ctx.branchIds.length === 0) return undefined;

    return { in: ctx.branchIds };
  }

  /** True when the caller may see data from every branch of the tenant. */
  canSeeAllBranches(): boolean {
    const ctx = getContext();
    if (!ctx || ctx.bypassTenantScope) return true;
    return (
      ctx.branchIds.length === 0 ||
      ctx.permissions.includes(Permission.ORDERS_VIEW_ALL_BRANCHES)
    );
  }
}
