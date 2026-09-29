# Backend tests

Two layers, deliberately split by what they can prove.

## Unit tests — `npm test`

Fast, no database, no network. They cover the rules that every client depends
on and that a refactor could silently break:

| File | Covers |
| --- | --- |
| `unit/order-status.spec.ts` | The order state machine (TZ §12) — including that an order cannot skip the kitchen or be cancelled after delivery. |
| `unit/rbac.spec.ts` | The permission catalog and default role grants (TZ §5). These encode privilege boundaries: a change that hands a cashier `payments.refund` fails here rather than shipping. |
| `unit/request-context.spec.ts` | Tenant-scope propagation through `AsyncLocalStorage`, including the lazy-promise regression described below. |

```bash
npm test --workspace=backend
npm run test:cov --workspace=backend
```

`@restor/shared-utils` carries its own suite (money, phone, geo, working
hours): `npm test --workspace=@restor/shared-utils`.

## API smoke test — `tests/smoke.ps1`

Runs against a **live server and a real database**. This is what proves the
flows TZ §61 asks for — login, tenant isolation, order creation, status
transitions — because they are exactly the things that only break once Prisma,
the guards and the middleware are all in play together.

```powershell
# 1. Postgres running, database migrated and seeded
npm run db:migrate --workspace=backend
npm run db:seed    --workspace=backend

# 2. API running
npm run dev:backend

# 3. In another shell
pwsh backend/tests/smoke.ps1
```

It asserts 59 checks across nine areas:

1. **Auth** — staff login, super-admin login, branch-scoped tokens, wrong
   password, anonymous access.
2. **RBAC** — role listing, permission catalog, a cashier being denied
   `roles.view`, a tenant owner being denied the platform routes.
3. **Branches & menu** — branch scoping, the public menu, variants, modifiers,
   discount pricing.
4. **Order pricing** — that totals are computed server-side, that modifiers
   from another product are rejected, that the branch minimum is enforced.
5. **Order lifecycle** — creation, `clientUuid` idempotency, illegal status
   jumps, the timeline.
6. **Kitchen** — tickets created from the domain event and split across
   stations.
7. **Tenant isolation** — a freshly created tenant sees zero branches, zero
   products and zero orders, and gets 404 for another tenant's records.
8. **Audit** — that actions are recorded and the log is tenant-scoped.
9. **Response contract** — the `{ success, data, error }` envelope and the
   request id.

The suite is re-runnable: it generates a unique phone and tenant name per run
and scopes its kitchen assertions to the order it just placed.

### Why this is a script rather than Jest e2e

The checks that matter most here are cross-cutting — middleware order, the
Prisma client extension, guard composition — and they only hold when the whole
process is wired together. Driving a real HTTP server keeps the test honest
about that, and keeps the fast unit suite free of a database dependency.

## Regressions worth knowing about

Two bugs this suite caught during development, both of which would have been
silent in production:

- **Lazy Prisma promises escaping the tenant scope.** `runUnscoped(() =>
  prisma.user.update(...))` returned an unresolved `PrismaPromise`; the
  `AsyncLocalStorage` scope exited before the caller's `await` triggered the
  query, so it ran in the *outer* context. Fixed by awaiting inside the scope
  — see the comment on `runUnscoped`.
- **`AND`-wrapping a unique `where`.** The scoping extension wrapped every
  filter as `{ AND: [caller, tenant] }`, which Prisma rejects for `update`,
  `delete` and `upsert` because those need a unique field at the top level.
  Fixed by merging the tenant as a sibling key.
