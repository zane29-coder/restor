# Database

PostgreSQL 16 + Prisma 6. Schema:
[`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma).

---

## Conventions

| Rule | Why |
| --- | --- |
| **IDs are UUIDs** | No sequential id leaks order volume to a competitor. Anything a human says aloud gets a separate readable field — see `Order.displayNumber` |
| **Money is `Int`, in minor units** | 156 000 UZS is `156000`. Floats never touch a price: rounding drift across a 2 000-order day is a real accounting problem |
| **Tenant-owned tables carry `tenantId`, indexed first** | Every query filters on it, so it belongs at the head of the composite index |
| **Soft deletes via `deletedAt`** | A six-month-old order still has to render its product names |
| **Enums mirror `@restor/shared-types`** | Change one and you must change the other in the same commit |
| **History snapshots its inputs** | `OrderItem` stores the name and price at order time, so a menu edit never rewrites a printed receipt |

---

## Tables

**Platform** — `tenants` · `plans` · `subscriptions`

**Identity & RBAC** — `users` · `refresh_tokens` · `roles` · `permissions` ·
`role_permissions` · `user_roles`

**Organisation** — `branches` · `branch_working_hours` · `employees`

**CRM** — `customers` · `customer_addresses`

**Menu** — `categories` · `products` · `product_variants` · `modifier_groups` ·
`modifiers` · `product_modifier_groups` · `product_branches`

**Orders** — `order_sequences` · `orders` · `order_items` ·
`order_item_modifiers` · `order_status_history` · `order_promotions`

**Payments** — `payments` · `payment_transactions`

**Cash** — `cash_registers` · `cash_shifts` · `cash_transactions`

**Delivery** — `couriers` · `courier_wallets` · `courier_transactions` ·
`courier_locations` · `deliveries` · `cash_handovers`

**Marketing** — `promotions` · `promo_codes` · `promo_code_usages` ·
`loyalty_programs` · `loyalty_levels` · `loyalty_accounts` ·
`loyalty_transactions`

**Telegram** — `telegram_configs` · `telegram_routes`

**Floor** — `tables` · `waiter_calls` · `kitchen_stations` ·
`kitchen_station_categories` · `kitchen_tickets` · `kitchen_ticket_items`

**Platform services** — `audit_logs` · `notifications` · `files`

---

## Decisions worth explaining

### Order numbers

`orders.number` is a per-branch counter; `displayNumber` is what staff say out
loud (`CH-1054`). Two tills taking an order in the same millisecond must not
both print `#1054`.

The counter lives in `order_sequences` and is advanced by a single atomic
statement inside the order's own transaction:

```sql
INSERT INTO order_sequences (...) VALUES (..., 1, NOW())
ON CONFLICT ("branchId", "periodKey")
DO UPDATE SET "lastNumber" = order_sequences."lastNumber" + 1
RETURNING "lastNumber"
```

Postgres takes a row lock for the duration, so concurrent callers serialise on
that one row rather than racing a read-then-write. Being inside the order's
transaction also means a failed insert rolls the counter back rather than
burning a number.

`periodKey` is `"ALL"` for a sequence that never resets, or a date for branches
that restart numbering daily.

### Idempotency

`orders` has `@@unique([tenantId, clientUuid])`. A POS replaying a queued
offline order sends the same key; the index turns the replay into a no-op and
the service returns the original order. Belt and braces: a pre-check for the
common case, the index to close the race between two concurrent replays
(TZ §18).

`payment_transactions.idempotencyKey` is unique for the same reason — a
replayed provider webhook must not double-credit an order (TZ §36).

### Denormalised aggregates

`customers` carries `ordersCount`, `totalSpent`, `averageCheck` and
`lastOrderAt`, updated when an order reaches `DELIVERED`. Without them the
customer list would aggregate the whole orders table on every page load.

`couriers` carries `lastLatitude` / `lastLongitude` so the dispatcher map is
one query rather than a join against the full location history.

### Nullable `tenantId`

Only on `users`, `roles`, `audit_logs`, `notifications` and `files`.

For `users` and `roles` it means "platform staff, outside every tenant" — that
is what lets the scoping extension run unscoped for a super admin. `roles` is
nonetheless **strictly** scoped, so a tenant never sees the global
`SUPER_ADMIN` role; each tenant gets its own copies of the system roles.

### Arrays instead of join tables

`promotions.branchIds`, `productIds`, `categoryIds` and `promo_codes.branchIds`
are `String[] @db.Uuid`. They are read as a whole on every evaluation and never
queried in reverse, so a join table would add three tables and buy nothing.
**An empty array means "applies everywhere"**, which is the common case.

### Cascade choices

- `onDelete: Cascade` where the child is meaningless alone: order items,
  refresh tokens, working hours.
- `onDelete: SetNull` where history must survive: `orders.createdByUserId`,
  `order_items.productId`, `cash_shifts.closedByUserId`.
- No cascade at all from `orders` to `branches` — a branch with open orders
  cannot be deleted, and the service says so explicitly.

---

## Indexing

Every tenant-scoped index leads with `tenantId`, because every query filters on
it. Composite indexes follow the access pattern of a real screen:

| Index | Serves |
| --- | --- |
| `orders(tenantId, status, createdAt)` | The admin order list, filtered by status |
| `orders(branchId, status, createdAt)` | One branch's board |
| `orders(courierId, status)` | The courier app's job list |
| `products(tenantId, categoryId, isActive)` | Menu by category |
| `product_branches(branchId, isAvailable, isStopListed)` | The customer menu's availability filter |
| `kitchen_tickets(branchId, status, createdAt)` | The KDS board |
| `audit_logs(tenantId, entity, entityId)` | "What happened to this order?" |

---

## Migrations

```bash
npm run db:migrate               # create + apply in development
npm run db:migrate:deploy        # apply in production (idempotent)
npm run db:studio                # browse
npm run db:sync-roles            # after adding a permission
```

Never edit the schema in production by hand (TZ §62). The production API
container runs `prisma migrate deploy` on start, so a rolling restart applies
pending migrations safely.

`prisma migrate reset` is destructive and refuses to run for an AI agent
without explicit human consent — which is correct. `db:sync-roles` exists
precisely so that adding a permission does **not** require a reset.

---

## Seed

`npm run db:seed` — idempotent, refuses to run with `NODE_ENV=production`.

Creates 86 permissions, 3 plans, a super admin, the `demo` tenant with 10
roles, 2 branches with working hours and a till each, 7 staff covering every
role, 5 categories with 11 products (variants, modifiers, one discounted), 6
kitchen stations and 16 QR tables.

Credentials are printed at the end and listed in the root README.
