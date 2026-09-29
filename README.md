# RESTOR

**Restaurant Operating System** — a multi-tenant SaaS platform for fast food
chains, cafés and restaurants. Telegram ordering, a web storefront, a POS
terminal, a kitchen display, a courier app and an admin panel, all served by a
single backend.

---

## Status

| Phase | Scope | State |
| --- | --- | --- |
| **1 — Foundation** | Monorepo, database, auth, tenant isolation, RBAC, branches, staff | ✅ Done, verified |
| **2 — Menu** | Categories, products, variants, modifiers, images, stop-list | ✅ Done, verified |
| **3 — Orders** | Cart pricing, orders, statuses, timeline, kitchen tickets | ✅ Done, verified |
| 4 — Telegram | Bot, group/topic routing, notifications | Contracts defined, module pending |
| 5 — Admin | Dashboard, orders, menu, branches, staff | ✅ Working |
| 6 — POS | Ordering, payments, shifts, receipts, offline | Ordering + offline queue done; shifts/receipts pending |
| 7 — KDS | Kitchen display, timers, stations | ✅ Working |
| 8 — Delivery | Couriers, assignment, GPS, wallet | App + API contracts done; assignment module pending |
| 9 — Finance | Payments, cashbox, reports | Schema + contracts done |
| 10 — Marketing | CRM, promotions, promo codes, loyalty | Promotions and promo codes work in pricing; admin UI pending |

**Verified:** 36 unit tests and a 59-check API smoke suite covering login,
RBAC, tenant isolation, server-side pricing, order lifecycle, idempotency and
the audit trail. See [backend/tests/README.md](backend/tests/README.md).

---

## Architecture

```
                         CUSTOMER
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
  Telegram Mini App    Customer web         QR / table
        │                   │                   │
        └───────────────────┼───────────────────┘
                            ▼
                    ┌───────────────┐
                    │  RESTOR API   │  ← ONE backend for everything
                    │   (NestJS)    │
                    └───────┬───────┘
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
         POS               KDS              Admin
          │                 │
          ▼                 ▼
       Payment           Kitchen
          │
          ▼
       Courier ──────────► Customer
```

All business logic lives in the backend. Every client is a thin, purpose-built
UI over the same API — there is no second backend anywhere (TZ §3, §69).

### Repository layout

```
restor/
├── backend/              NestJS API — the only backend
│   ├── prisma/           Schema, migrations, seed, role sync
│   ├── src/
│   │   ├── common/       Context, guards, interceptors, filters, crypto
│   │   ├── config/       Environment validation and typed config
│   │   ├── database/     Prisma service + tenant-scoping extension
│   │   └── modules/      auth, rbac, platform, branches, employees,
│   │                     catalog, orders, kitchen, storage, audit, realtime
│   └── tests/            Unit tests + API smoke suite
│
├── apps/
│   ├── admin-web/        Admin panel          (React + Vite)
│   ├── customer-web/     Storefront           (React + Vite)
│   ├── telegram-mini-app/Telegram Mini App    (React + Vite)
│   ├── pos/              POS terminal         (React + Vite, offline queue)
│   ├── kitchen-display/  KDS                  (React + Vite)
│   └── courier-mobile/   Courier APK          (React Native + Expo)
│
├── packages/
│   ├── shared-types/     API contracts, enums, RBAC catalog
│   ├── shared-utils/     Money, phone, geo, working hours, pagination
│   ├── validation/       Zod schemas used by BOTH the API and the forms
│   ├── api-client/       Typed client with auth + refresh
│   └── ui/               Design tokens and shared React primitives
│
├── infrastructure/
│   ├── nginx/            Reverse proxy, TLS, rate limits
│   ├── deployment/       server-setup, init-ssl, deploy, backup
│   └── database/         Init scripts and backups
│
└── docs/                 Architecture, database, API, auth, deployment
```

Each deployable app is its own project. Nothing like `frontend/src/pos` exists
anywhere (TZ §2, §70).

---

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| API | NestJS 10 + TypeScript | Its module/provider structure maps directly onto the controller → service → repository layering the spec asks for |
| Database | PostgreSQL 16 + Prisma 6 | Type-safe queries, first-class migrations, and a client extension that can enforce tenant scoping below the service layer |
| Cache / queue | Redis + BullMQ | Sessions, rate limits, background notification jobs |
| Web apps | React 18 + Vite | Independent SPAs; no SSR runtime to operate |
| Courier app | React Native + Expo | Shares the TypeScript packages directly; EAS builds the APK |
| Auth | JWT access + rotating refresh, Argon2id | Stateless authorisation with revocable sessions |
| Realtime | Socket.IO | Order status, KDS, courier tracking |

---

## Quick start

**Requirements:** Node ≥ 20, PostgreSQL ≥ 14 (Docker or local), Redis
(optional in development).

```bash
git clone <repo> restor && cd restor
npm install

# Infrastructure — or point DATABASE_URL at a local Postgres
docker compose up -d postgres redis

# Backend configuration
cp backend/.env.example backend/.env
# Generate the secrets it asks for:
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

npm run build:packages
npm run db:migrate
npm run db:seed

npm run dev:backend        # http://localhost:3000  (docs: /api/docs)
```

Then, in separate shells:

```bash
npm run dev:admin      # http://localhost:5173  admin panel
npm run dev:customer   # http://localhost:5174  storefront
npm run dev:pos        # http://localhost:5175  POS
npm run dev:kds        # http://localhost:5176  kitchen display
npm run dev:miniapp    # http://localhost:5177  Telegram Mini App
```

### Seeded credentials — development only

Password for every account: `Restor2026dev`

| Role | Phone | Tenant |
| --- | --- | --- |
| SUPER_ADMIN | `+998900000000` | — (platform) |
| OWNER | `+998901111111` | `demo` |
| COMPANY_ADMIN | `+998902222222` | `demo` |
| BRANCH_MANAGER | `+998903333333` | `demo` |
| CASHIER | `+998904444444` | `demo` |
| KITCHEN | `+998905555555` | `demo` |
| COURIER | `+998906666666` | `demo` |
| FINANCE | `+998907777777` | `demo` |

The seed also creates two branches, 5 categories, 11 products with variants and
modifiers, kitchen stations and 16 QR tables.

---

## Commands

```bash
npm run build:packages     # shared packages (run before the backend)
npm run build              # packages + backend
npm run build:all          # everything, including the web apps
npm run typecheck          # every workspace
npm test                   # every workspace

npm run db:migrate         # create and apply a migration
npm run db:seed            # development data
npm run db:sync-roles      # re-apply role grants after a permission change
npm run db:studio          # Prisma Studio
```

---

## How multi-tenancy is enforced

Three layers, each of which fails closed:

1. **The tenant comes from the verified JWT and nowhere else.** A `tenantId` in
   a body, query or header is ignored. Public storefront traffic resolves its
   tenant from the URL slug or hostname, server-side (TZ §47, §52).
2. **A Prisma client extension injects the tenant filter into every query**, so
   a forgotten `where` returns nothing rather than another company's orders
   (TZ §53). Inside a request with no tenant and no explicit bypass, a scoped
   query *throws*.
3. **Authorisation is by granular permission, never by role name** — which is
   what lets a tenant's own custom role behave exactly like a built-in one
   (TZ §5).

The smoke suite asserts all of this: a freshly created tenant sees zero
branches, zero products and zero orders, and gets 404 for another tenant's
records by id.

---

## Documentation

| Document | Contents |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | Layers, request lifecycle, module map |
| [docs/database.md](docs/database.md) | Schema, conventions, indexing |
| [docs/api.md](docs/api.md) | Conventions, response envelope, endpoints |
| [docs/authentication.md](docs/authentication.md) | Tokens, refresh rotation, Telegram sign-in |
| [docs/permissions.md](docs/permissions.md) | The RBAC catalog and role defaults |
| [docs/order-flow.md](docs/order-flow.md) | Pricing, state machine, idempotency |
| [docs/deployment.md](docs/deployment.md) | VPS setup, TLS, deploy, backups |
| [backend/tests/README.md](backend/tests/README.md) | What is tested and why |

---

## Licence

Proprietary. All rights reserved.
