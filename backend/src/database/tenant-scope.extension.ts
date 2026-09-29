import { Prisma } from '@prisma/client';
import { ErrorCode } from '@restor/shared-types';
import { AppException } from '../common/errors/app-exception';
import { getContext } from '../common/context/request-context';

/**
 * Automatic tenant scoping (TZ §4, §52, §53).
 *
 * Rather than trusting every developer to remember `AND tenant_id = ?` on
 * every query, this Prisma client extension injects the filter below the
 * service layer. A forgotten `where` therefore cannot leak another company's
 * orders — the worst case is a query that returns nothing.
 *
 * It fails CLOSED: inside a request whose context has no tenant and no
 * explicit bypass, a scoped query throws instead of silently running
 * unscoped.
 *
 * ---------------------------------------------------------------------------
 * KNOWN BOUNDARY — child tables
 *
 * Tables that carry no `tenantId` of their own (order_items, modifiers,
 * product_variants, refresh_tokens, …) cannot be scoped here. They are
 * reachable only through a scoped parent, so services MUST load them via the
 * parent (`prisma.order.findFirst({ include: { items: true } })`) rather than
 * querying the child table by a raw id. `assertOwnedByTenant` below is the
 * escape hatch for the rare case where that is impractical.
 * ---------------------------------------------------------------------------
 */

/** Models whose rows belong to exactly one tenant via a `tenantId` column. */
const STRICT_TENANT_MODELS = new Set<string>([
  'Subscription',
  'User',
  'Role',
  'Branch',
  'Employee',
  'Customer',
  'Category',
  'Product',
  'ModifierGroup',
  'Order',
  'Payment',
  'CashRegister',
  'CashShift',
  'CashTransaction',
  'Courier',
  'CourierTransaction',
  'CashHandover',
  'Delivery',
  'Promotion',
  'PromoCode',
  'LoyaltyProgram',
  'LoyaltyAccount',
  'TelegramConfig',
  'RestaurantTable',
  'WaiterCall',
  'KitchenStation',
  'AuditLog',
  'Notification',
  'FileAsset',
]);

/**
 * No model is currently "shared across tenants via `tenantId: null`".
 *
 * `Role` looked like a candidate, but each tenant is seeded with its OWN
 * copies of the system roles, and the only role that genuinely has
 * `tenantId: null` is SUPER_ADMIN — which a tenant must never see, let alone
 * assign. Strict scoping is therefore both simpler and safer.
 *
 * Should a genuinely shared model appear, it needs its own read path here
 * (`{ OR: [{ tenantId }, { tenantId: null }] }` for reads, strict for writes),
 * not an entry in {@link STRICT_TENANT_MODELS}.
 */

/** The tenant table itself is scoped on `id`, not on a `tenantId` column. */
const SELF_SCOPED_MODELS = new Set<string>(['Tenant']);

const READ_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

const WRITE_WHERE_OPERATIONS = new Set([
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);

/**
 * `findUnique` accepts only unique fields in `where`, so adding `tenantId`
 * would be rejected by Prisma. These are rewritten to their `findFirst`
 * equivalent, which accepts arbitrary filters and returns the same shape.
 */
const UNIQUE_TO_FIRST: Record<string, string> = {
  findUnique: 'findFirst',
  findUniqueOrThrow: 'findFirstOrThrow',
};

type AnyArgs = Record<string, unknown>;

function scopeFieldFor(model: string): 'id' | 'tenantId' {
  return SELF_SCOPED_MODELS.has(model) ? 'id' : 'tenantId';
}

function isScoped(model: string): boolean {
  return STRICT_TENANT_MODELS.has(model) || SELF_SCOPED_MODELS.has(model);
}

/**
 * Merges the tenant filter into the caller's `where` as a SIBLING key.
 *
 * Deliberately not `{ AND: [caller, tenant] }`: `update`, `delete` and
 * `upsert` take a `WhereUniqueInput`, which must carry a unique field at the
 * top level. Wrapping everything in `AND` buries it and Prisma rejects the
 * call outright ("Unknown argument `tenantId_phone`"). Prisma 5+ does accept
 * extra non-unique filters alongside the unique one, which is exactly what
 * this produces.
 *
 * Merging last also means a caller cannot widen the scope: their own
 * `tenantId` is overwritten by ours, and any `OR`/`AND` they supplied is
 * still ANDed with it by Prisma's normal semantics.
 */
function withTenantFilter(
  where: unknown,
  field: string,
  tenantId: string,
): Record<string, unknown> {
  if (where === undefined || where === null) return { [field]: tenantId };
  return { ...(where as Record<string, unknown>), [field]: tenantId };
}

export function createTenantScopeExtension() {
  return Prisma.defineExtension((client) =>
    client.$extends({
      name: 'restor-tenant-scope',
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (!isScoped(model)) {
              return query(args);
            }

            const context = getContext();

            // Outside any request (boot, migrations, CLI scripts) there is no
            // scope to enforce; those paths are trusted by construction.
            if (!context) {
              return query(args);
            }

            // Platform staff and explicitly-unscoped system work.
            if (context.bypassTenantScope) {
              return query(args);
            }

            const tenantId = context.tenantId;
            if (!tenantId) {
              // Naming the query matters: without it this error tells an
              // operator only that "something" ran unscoped.
              throw new AppException(
                ErrorCode.TENANT_SCOPE_MISSING,
                `No tenant in the request context for ${model}.${operation}; ` +
                  'refusing to run an unscoped query',
                500,
              );
            }

            const field = scopeFieldFor(model);
            const nextArgs: AnyArgs = { ...(args as AnyArgs) };

            if (READ_OPERATIONS.has(operation)) {
              nextArgs.where = withTenantFilter(nextArgs.where, field, tenantId);

              const rewritten = UNIQUE_TO_FIRST[operation];
              if (rewritten) {
                // `findUnique` rejects non-unique filters; `findFirst` does not.
                const delegate = (client as unknown as Record<string, Record<string, Function>>)[
                  lowerFirst(model)
                ];
                return delegate[rewritten]!(nextArgs);
              }

              return query(nextArgs);
            }

            if (WRITE_WHERE_OPERATIONS.has(operation)) {
              nextArgs.where = withTenantFilter(nextArgs.where, field, tenantId);

              if (operation === 'upsert' && nextArgs.create) {
                nextArgs.create = withTenant(nextArgs.create, field, tenantId, model);
              }

              return query(nextArgs);
            }

            if (CREATE_OPERATIONS.has(operation)) {
              const data = nextArgs.data;
              nextArgs.data = Array.isArray(data)
                ? data.map((row) => withTenant(row, field, tenantId, model))
                : withTenant(data, field, tenantId, model);

              return query(nextArgs);
            }

            return query(nextArgs);
          },
        },
      },
    }),
  );
}

/** Stamps the tenant onto a create payload, refusing a mismatched explicit id. */
function withTenant(data: unknown, field: string, tenantId: string, model: string): unknown {
  if (data === undefined || data === null || typeof data !== 'object') {
    return { [field]: tenantId };
  }

  const row = data as AnyArgs;
  const existing = row[field];

  if (existing !== undefined && existing !== null && existing !== tenantId) {
    throw new AppException(
      ErrorCode.CROSS_TENANT_ACCESS,
      `Refusing to create a ${model} for a different tenant`,
      403,
    );
  }

  // `id` on a self-scoped model (Tenant) is generated, not forced.
  if (field === 'id') return row;

  return { ...row, [field]: tenantId };
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/**
 * Guard for the child tables the extension cannot reach.
 *
 * Call it after loading a row whose model carries no `tenantId`, passing the
 * tenant of its parent. Throws rather than returning a boolean so a forgotten
 * `if` cannot turn into a silent leak.
 */
export function assertOwnedByTenant(
  ownerTenantId: string | null | undefined,
  entity = 'resource',
): void {
  const context = getContext();
  if (!context || context.bypassTenantScope) return;

  if (!ownerTenantId || ownerTenantId !== context.tenantId) {
    throw new AppException(
      ErrorCode.CROSS_TENANT_ACCESS,
      `This ${entity} belongs to another tenant`,
      403,
    );
  }
}
