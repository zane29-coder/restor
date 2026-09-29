import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Ambient per-request state (TZ §52, §53, §59).
 *
 * Carried in `AsyncLocalStorage` rather than passed down every call signature,
 * because the consumer that matters most is the Prisma client extension — it
 * sits below the service layer and must know the tenant without every
 * repository method threading it through by hand.
 *
 * The tenant here comes from the verified JWT and nowhere else. A `tenantId`
 * in a request body, query string or header is never trusted.
 */
export interface RequestContext {
  /** Correlates logs, audit rows and the response's `meta.requestId`. */
  requestId: string;

  /** Authenticated user, or `undefined` on a public route. */
  userId?: string;

  /**
   * Tenant every query is scoped to.
   *
   * `undefined` together with `bypassTenantScope: false` makes the Prisma
   * extension REFUSE tenant-scoped queries — that combination means something
   * forgot to establish scope, and failing closed is the only safe default.
   */
  tenantId?: string;

  /**
   * Set only for platform staff (SUPER_ADMIN) and trusted system work such as
   * seeding, migrations and webhook handlers that must look a tenant up before
   * they know which one it is.
   */
  bypassTenantScope: boolean;

  /** Branches the user may act on; empty means every branch of the tenant. */
  branchIds: string[];

  /** Flattened permission codes from every role the user holds. */
  permissions: string[];

  /** Present on courier tokens, so the mobile app can query its own jobs. */
  courierId?: string;

  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` with `context` visible to everything it awaits. */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The active context, or `undefined` outside a request (boot, CLI, jobs). */
export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Mutates the live context.
 *
 * Used by the auth guard, which runs after the context is created but is the
 * first place that knows who the caller is.
 */
export function patchContext(patch: Partial<RequestContext>): void {
  const current = storage.getStore();
  if (current) Object.assign(current, patch);
}

export function getTenantId(): string | undefined {
  return storage.getStore()?.tenantId;
}

export function getUserId(): string | undefined {
  return storage.getStore()?.userId;
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** A fresh context for system work that legitimately spans tenants. */
export function createSystemContext(
  overrides: Partial<RequestContext> = {},
): RequestContext {
  return {
    requestId: overrides.requestId ?? `system-${Date.now()}`,
    bypassTenantScope: true,
    branchIds: [],
    permissions: [],
    ...overrides,
  };
}

/**
 * Runs `fn` outside tenant scoping.
 *
 * Deliberately explicit and deliberately rare: seeds, background jobs that
 * sweep every tenant, and the login path (which must find a user before it
 * knows their tenant). Reach for it anywhere else and you are probably about
 * to leak data across tenants.
 *
 * ---------------------------------------------------------------------------
 * WHY THE INNER `async` WRAPPER IS LOAD-BEARING
 *
 * A Prisma call is LAZY: `prisma.user.update(...)` builds a `PrismaPromise`
 * and does nothing until something calls `.then()`. Written naively as
 * `storage.run(ctx, fn)`, `fn` would return that unresolved promise, the ALS
 * scope would exit immediately, and the caller's `await` would trigger the
 * query — and the scoping extension — back in the OUTER context.
 *
 * Awaiting inside the scope keeps the query's execution where the caller
 * intended it. Removing the wrapper reintroduces a silent, hard-to-trace
 * tenant-scoping bug.
 * ---------------------------------------------------------------------------
 */
export async function runUnscoped<T>(fn: () => T | Promise<T>): Promise<T> {
  const current = storage.getStore();
  return storage.run(
    { ...createSystemContext(), ...current, bypassTenantScope: true },
    async () => await fn(),
  );
}

/**
 * Runs `fn` scoped to one tenant — for jobs and event listeners that have no
 * HTTP request behind them. Awaits inside the scope for the reason above.
 */
export async function runAsTenant<T>(
  tenantId: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const current = storage.getStore();
  return storage.run(
    { ...createSystemContext(), ...current, tenantId, bypassTenantScope: false },
    async () => await fn(),
  );
}
