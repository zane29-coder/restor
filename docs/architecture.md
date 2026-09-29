# Architecture

Written for: engineers joining the codebase.

---

## The one rule

**All business logic lives in the backend.** Every client — admin panel, POS,
KDS, storefront, Mini App, courier app — is a thin UI over the same API.

This is not stylistic. The POS and the Mini App must charge the same price for
the same cart; the KDS and the admin panel must agree on what an order's status
can become next. The only way to guarantee that is for exactly one place to
decide, and for the clients to ask.

Concretely: a client sends *what* was ordered (product ids, quantities,
modifier ids) and never *what it costs*. The server prices every line from the
live menu (TZ §76).

---

## Request lifecycle

```
HTTP request
   │
   ├─ RequestContextMiddleware   creates an EMPTY AsyncLocalStorage context
   │                             (no tenant, no bypass) and a request id
   │
   ├─ TenantResolverMiddleware   public traffic only: resolves the tenant from
   │                             X-Tenant-Slug or the Host header
   │
   ├─ JwtAuthGuard (global)      verifies the bearer token, overwrites the
   │                             context's tenant/permissions from its claims
   │
   ├─ PermissionsGuard (global)  checks @RequirePermissions against the token
   │
   ├─ ThrottlerGuard             rate limiting
   │
   ├─ ZodValidationPipe          validates AND transforms the body
   │
   ├─ Controller → Service → PrismaService
   │                             every query passes through the tenant-scoping
   │                             client extension
   │
   ├─ ResponseInterceptor        wraps the result in { success, data, error }
   └─ AllExceptionsFilter        turns any throw into the same envelope
```

The context starts in the deliberately unsafe-to-query state — no tenant, no
bypass — so a route that somehow reaches Prisma before authentication fails
closed rather than running unscoped.

---

## Tenant isolation

Three independent layers. Any one failing still leaves the others.

### 1. The tenant comes from the token

`JwtAuthGuard` reads `tenantId` from the verified JWT and writes it into the
request context. A `tenantId` in a body, query string or header is ignored
entirely (TZ §52).

Public storefront traffic has no token, so `TenantResolverMiddleware` resolves
the tenant from the `X-Tenant-Slug` header or the `Host` — but it looks the id
up server-side from a public slug. The client still never supplies an id, and
because the middleware runs *before* the guard, a real token always wins.

### 2. Queries are scoped below the service layer

`src/database/tenant-scope.extension.ts` is a Prisma client extension that
merges `tenantId` into the `where` of every read, write and delete on a
tenant-owned model, and stamps it onto every create.

A forgotten `where` therefore returns nothing rather than another company's
orders. Inside a request whose context has no tenant and no explicit bypass, a
scoped query **throws** — it fails closed.

Two implementation details that are load-bearing:

- The filter is merged as a **sibling key**, not wrapped in `AND`. `update`,
  `delete` and `upsert` take a `WhereUniqueInput` that must carry a unique
  field at the top level; burying it in `AND` makes Prisma reject the call.
- `findUnique` is rewritten to `findFirst`, because it accepts only unique
  fields and would reject the added filter.

**Known boundary:** tables without a `tenantId` of their own (`order_items`,
`product_variants`, `refresh_tokens`, …) cannot be scoped here. They are
reachable only through a scoped parent, so services must load them via the
parent. `assertOwnedByTenant()` is the explicit escape hatch.

### 3. Crossing tenants is explicit and greppable

`runUnscoped()` and `runAsTenant()` are the only ways out, and there are few
call sites: login (which must find a user before it knows their tenant), the
audit writer (platform actions log against another tenant), the platform
module, and the seed.

Both `await` **inside** the AsyncLocalStorage scope. That is not decoration: a
Prisma call is lazy, so `runUnscoped(() => prisma.user.update(...))` written
naively returns an unresolved promise, the scope exits, and the caller's
`await` runs the query — and the extension — back in the *outer* context. That
bug existed and is covered by a regression test.

---

## Authorisation

Guards check **permissions**, never role names (TZ §5).

A permission is a dotted `resource.action` string. Roles are named bundles of
them. The eleven system roles are seeded per tenant as ordinary rows, so a
tenant's own "Senior Cashier" behaves exactly like a built-in role, and
granting a capability is a data change rather than a code change.

`SUPER_ADMIN` lives outside every tenant (`tenantId: null` on both the user and
the role) and short-circuits the guard, so a newly added permission never has
to be back-filled into it.

Branch scoping is a second axis: a `UserRole` row may carry a `branchId`. An
empty branch list means "every branch of the tenant", which is how owners are
represented. `BranchScope` is a service-layer helper rather than a guard,
because most endpoints need to *filter a list* rather than gate a route.

---

## Modules

| Module | Responsibility |
| --- | --- |
| `auth` | Login, refresh rotation, Telegram `initData` verification, passwords |
| `rbac` | Roles and the permission catalog |
| `platform` | Super-admin: tenants, plans, subscriptions, platform stats |
| `subscriptions` | Plan limits, enforced server-side on every create |
| `branches` | Branches, working hours, delivery settings |
| `employees` | Staff accounts, role assignment, deactivation |
| `catalog` | Categories, products, variants, modifiers, the customer menu |
| `orders` | Pricing, creation, the status machine, the timeline |
| `kitchen` | Tickets, station routing |
| `storage` | Image uploads behind a provider abstraction |
| `audit` | Append-only audit trail |
| `realtime` | Socket.IO gateway |
| `health` | Liveness and readiness probes |

Each has `controller` / `service` / `module`, with mappers and helpers split
out where a file would otherwise grow past comfortable reading (TZ §68).

---

## Events

Domain events decouple side effects from the request that caused them
(TZ §58). `OrdersService` emits `order.created`; the kitchen module creates
tickets in response, and the realtime gateway pushes to subscribed screens.

The kitchen is a *consumer* of orders, not part of placing one — a KDS failure
must never fail a sale.

Listeners run outside an HTTP request, so they re-establish the tenant with
`runAsTenant(payload.tenantId, …)`. Without it the scoping extension would
correctly refuse their queries.

---

## Money

Every amount is an **integer in the currency's minor unit**. UZS has no
subunit, so 156 000 UZS is stored as `156000`.

Floats never touch a price. Rounding drift across a two-thousand-order day is a
real accounting problem, and `@restor/shared-utils/money` provides arithmetic
that refuses non-integer input outright — `addMoney(100.5, 1)` throws.

Percentage discounts round half-up, which is what a customer expects from a
printed receipt, and `splitMoney` distributes the remainder so the parts sum
back exactly.

---

## Shared packages

| Package | Contents | Consumers |
| --- | --- | --- |
| `shared-types` | API contracts, enums, RBAC catalog, the order state machine | Everything |
| `shared-utils` | Money, phone, geo, working hours, pagination | Everything |
| `validation` | Zod schemas | Backend pipe **and** client forms |
| `api-client` | Typed client, refresh queue, error normalisation | All clients |
| `ui` | Design tokens, a few React primitives | Web apps |

`validation` being shared is what stops a rule drifting between what the form
accepts and what the API accepts. `zod` is a peer dependency so every consumer
shares one instance — two copies produce schemas that fail each other's
`instanceof` checks.

Packages compile to CommonJS because NestJS consumes them; the Vite apps handle
that with `commonjsOptions.include`, and Metro with its monorepo config.

Nothing platform-specific goes in a shared package (TZ §71) — no Node APIs, no
DOM, no React Native. The POS and the admin panel share tokens and types, not
components: a "shared" component bent to serve both a mouse-driven dashboard
and a gloved-hand touchscreen serves neither.
