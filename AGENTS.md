# RESTOR — agent guide

Multi-tenant restaurant SaaS. One backend serves many restaurants; six client
apps sit on top of it.

**Read this file in full. Then read only the one or two docs your task names.**
Everything below is routing — the detail lives in `docs/`. Opening files at
random to work out how something behaves costs more than reading the doc that
already explains it.

---

## Read this before touching anything

Four rules the whole codebase depends on. Breaking one is a bug even when the
tests pass.

1. **Tenant comes from the verified JWT, never from the request.** A Prisma
   client extension injects `tenantId` below the service layer, and fails
   CLOSED — a query with no tenant in context throws rather than running
   unscoped. Never add a `tenantId` parameter to an endpoint.
2. **The server prices everything.** Clients send what was ordered, never what
   it costs. A payload carrying a price is a bug.
3. **Money is integers in minor units.** UZS has no subunit, so `156000` is
   156 000 soʻm. Never a float. Stock quantities are the one exception and use
   `NUMERIC(14,3)`.
4. **Uzbek in the UI, English in the code.** User-facing strings, including
   error messages that reach a screen, are Uzbek. Identifiers, comments and
   commit messages are English.

---

## Where to look

### Working on the backend
| Task | Read |
| --- | --- |
| Anything backend | `docs/architecture/backend.md` |
| Request lifecycle, tenant isolation, events | `docs/architecture/overview.md` |
| Adding or changing an endpoint | `docs/architecture/api.md` |
| Schema, migrations, seed | `docs/architecture/data-model.md` |
| Login, tokens, Telegram auth | `docs/architecture/auth.md` |
| Roles, permissions, adding one | `docs/architecture/permissions.md` |

### Working on a feature
| Area | Read |
| --- | --- |
| Orders, pricing, status flow, POS offline | `docs/product/orders.md` |
| Till, shifts, tenders, refunds | `docs/product/payments.md` |
| Delivery, courier app, cash handover | `docs/product/couriers.md` |
| Menu, categories, modifiers, images | `docs/product/menu.md` |
| Promotions and promo codes | `docs/product/marketing.md` |
| Customers and loyalty points | `docs/product/customers.md` |
| Stock, suppliers, recipes | `docs/product/inventory.md` |
| QR dine-in and waiter calls | `docs/product/tables.md` |
| Sales, ABC, finance reports | `docs/product/reports.md` |

### Working on a client app
| Task | Read |
| --- | --- |
| Any of the six apps | `docs/architecture/frontend.md` |

### Working on an integration
| Task | Read |
| --- | --- |
| Online payment (Atmos / Click / Payme) | `docs/integrations/subo.md` |
| Bot, order notifications, Mini App | `docs/integrations/telegram.md` |

### Deploying or operating
| Task | Read |
| --- | --- |
| Shipping a change to production | `docs/operations/deploy.md` |
| Servers, access, secrets, backups | `docs/operations/servers.md` |
| Running the tests | `docs/operations/testing.md` |
| Building the courier APK | `apps/courier-mobile/README.md` |

### Before you start, and when you are stuck
| Question | Read |
| --- | --- |
| What state is the project in right now? | `docs/context/CURRENT.md` |
| Why is it built this way? | `docs/context/DECISIONS.md` |
| Is this already a known problem? | `docs/context/KNOWN_ISSUES.md` |

---

## Repository layout

```
backend/              NestJS 10 + Prisma 6 + PostgreSQL 16 + Redis
  src/modules/        one folder per domain — see architecture/backend.md
  prisma/             schema.prisma, migrations/, seed.ts
  tests/unit/         jest, no database
  tests/*.ps1         smoke tests against a live server

packages/             shared across every app, built before anything else
  shared-types/       enums, models, Permission catalog — the contract
  shared-utils/       money, dates, geo, phone
  validation/         Zod schemas, used by BOTH server and forms
  api-client/         the only place any app talks to the API
  ui/                 inline SVG icons

apps/
  admin-web/          admin panel + the separate super-admin surface
  pos/                till
  kitchen-display/    KDS
  customer-web/       storefront
  telegram-mini-app/  Mini App
  courier-mobile/     React Native, built as an APK

infrastructure/       nginx configs, deploy scripts, backups
docs/                 everything this file routes to
```

## Commands

```bash
npm install                 # once, from the repo root
npm run build:packages      # ALWAYS before building or typechecking an app
npm run typecheck           # every workspace
npm test                    # unit tests

npm run dev:backend         # :3000
npm run dev:admin           # :5173
```

`packages/` must be built before anything that imports them. A confusing type
error in an app is almost always a stale `packages/*/dist`.

## Conventions that are easy to get wrong

- **Add a permission** → it must be added in three places and then granted on
  the server. `docs/architecture/permissions.md` has the checklist.
- **Add a migration** → hand-written SQL, applied on container start. Never
  `prisma migrate reset` against a server. See `docs/architecture/data-model.md`.
- **Paginated endpoints** → the server splits a page across `data` and
  `meta.pagination`. Use `http.getPaginated`, never `http.get<Paginated<T>>`.
- **PowerShell on Windows** → `.ps1` files are read as ANSI, so smoke tests are
  ASCII-only. A Uzbek apostrophe in one breaks the parse.
