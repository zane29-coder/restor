import {
  createSystemContext,
  getContext,
  getTenantId,
  patchContext,
  runAsTenant,
  runUnscoped,
  runWithContext,
  type RequestContext,
} from '../../src/common/context/request-context';

function baseContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: 'test-request',
    bypassTenantScope: false,
    branchIds: [],
    permissions: [],
    ...overrides,
  };
}

/**
 * The ambient request context is what the tenant-scoping Prisma extension
 * reads. A regression here is a cross-tenant data leak, so these tests cover
 * the propagation rules rather than just the getters.
 */
describe('request context', () => {
  it('is empty outside a request', () => {
    expect(getContext()).toBeUndefined();
  });

  it('fails closed: a fresh context has no tenant and no bypass', () => {
    runWithContext(baseContext(), () => {
      const ctx = getContext()!;
      expect(ctx.tenantId).toBeUndefined();
      expect(ctx.bypassTenantScope).toBe(false);
    });
  });

  it('exposes the tenant inside the scope only', () => {
    runWithContext(baseContext({ tenantId: 'tenant-a' }), () => {
      expect(getTenantId()).toBe('tenant-a');
    });
    expect(getTenantId()).toBeUndefined();
  });

  it('patchContext mutates the live context (used by the auth guard)', () => {
    runWithContext(baseContext(), () => {
      patchContext({ userId: 'user-1', tenantId: 'tenant-a', permissions: ['orders.view'] });

      const ctx = getContext()!;
      expect(ctx.userId).toBe('user-1');
      expect(ctx.tenantId).toBe('tenant-a');
      expect(ctx.permissions).toEqual(['orders.view']);
    });
  });

  it('createSystemContext bypasses scoping', () => {
    expect(createSystemContext().bypassTenantScope).toBe(true);
  });

  /**
   * The regression this guards against: a Prisma call is lazy, so
   * `runUnscoped(() => prisma.x.y())` used to return an unresolved promise and
   * let the query execute back in the OUTER context. The await has to happen
   * INSIDE the scope.
   */
  it('runUnscoped keeps the bypass active while an async callback resolves', async () => {
    let seenDuringAwait: boolean | undefined;

    await runWithContext(baseContext({ tenantId: 'tenant-a' }), async () => {
      await runUnscoped(async () => {
        // A tick, standing in for the database round trip.
        await new Promise((resolve) => setTimeout(resolve, 5));
        seenDuringAwait = getContext()?.bypassTenantScope;
      });
    });

    expect(seenDuringAwait).toBe(true);
  });

  it('runUnscoped survives a lazily-resolved thenable', async () => {
    let seen: boolean | undefined;

    // Mimics a PrismaPromise: nothing runs until `.then()` is called.
    const lazy = {
      then(resolve: (value: unknown) => void) {
        seen = getContext()?.bypassTenantScope;
        resolve(null);
      },
    };

    await runWithContext(baseContext({ tenantId: 'tenant-a' }), () =>
      runUnscoped(() => lazy as unknown as Promise<unknown>),
    );

    expect(seen).toBe(true);
  });

  it('restores the caller’s scope after runUnscoped returns', async () => {
    await runWithContext(baseContext({ tenantId: 'tenant-a' }), async () => {
      await runUnscoped(async () => undefined);

      const ctx = getContext()!;
      expect(ctx.tenantId).toBe('tenant-a');
      expect(ctx.bypassTenantScope).toBe(false);
    });
  });

  it('runAsTenant switches tenant and re-enables scoping', async () => {
    let inner: { tenantId?: string; bypass: boolean } | undefined;

    await runWithContext(baseContext({ bypassTenantScope: true }), async () => {
      await runAsTenant('tenant-b', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        const ctx = getContext()!;
        inner = { tenantId: ctx.tenantId, bypass: ctx.bypassTenantScope };
      });
    });

    expect(inner).toEqual({ tenantId: 'tenant-b', bypass: false });
  });

  it('keeps concurrent requests isolated from each other', async () => {
    const observe = (tenantId: string, delayMs: number) =>
      runWithContext(baseContext({ tenantId }), async () => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return getTenantId();
      });

    const [a, b, c] = await Promise.all([
      observe('tenant-a', 20),
      observe('tenant-b', 5),
      observe('tenant-c', 12),
    ]);

    expect([a, b, c]).toEqual(['tenant-a', 'tenant-b', 'tenant-c']);
  });
});
