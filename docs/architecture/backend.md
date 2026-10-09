# Backend

NestJS 10, Prisma 6, PostgreSQL 16, Redis. Everything is served under
`/api/v1` — build absolute URLs with `apiUrl()` from `common/constants.ts`.

For the request lifecycle, tenant isolation and the event bus, read
`overview.md`. This file is the map: which module owns what, and how to add
one.

## Modules

`backend/src/modules/`

| Module | Owns | Feature doc |
| --- | --- | --- |
| `auth` | Login, tokens, refresh rotation, Telegram auth | `../architecture/auth.md` |
| `rbac` | Roles, permission checks | `../architecture/permissions.md` |
| `platform` | Tenants, plans — SUPER_ADMIN only | — |
| `subscriptions` | Plan limits (branches, employees, terminals) | — |
| `branches` | Branches, working hours, delivery pricing rules | `../product/orders.md` |
| `employees` | Staff accounts and role assignment | — |
| `catalog` | Categories, products, variants, modifier groups | `../product/menu.md` |
| `storage` | Image upload | `../product/menu.md` |
| `orders` | Order creation, pricing, status machine | `../product/orders.md` |
| `kitchen` | KDS tickets | `../product/orders.md` |
| `realtime` | Socket.IO gateway | `overview.md` |
| `notifications` | Queued outbound messages | `../integrations/telegram.md` |
| `telegram` | Bot config, routing, Mini App auth | `../integrations/telegram.md` |
| `couriers` | Dispatch, courier app, wallet, handover | `../product/couriers.md` |
| `cash` | Registers, shifts, drawer movements | `../product/payments.md` |
| `payments` | Tenders, refunds, Subo checkout and webhook | `../product/payments.md` |
| `marketing` | Promotions, promo codes | `../product/marketing.md` |
| `customers` | CRM, loyalty points | `../product/customers.md` |
| `inventory` | Stock, suppliers, recipes, deduction | `../product/inventory.md` |
| `reports` | Sales, ABC, finance | `../product/reports.md` |
| `tables` | QR dine-in, waiter calls | `../product/tables.md` |
| `audit` | Append-only change log | — |
| `health` | Probes | — |

## Shape of a module

```
modules/<name>/
  <name>.module.ts       wiring
  <name>.controller.ts   routes, permissions, Zod validation
  <name>.service.ts      the work
  <name>.math.ts         extracted pure arithmetic, where there is any
```

Controllers do three things and no more: declare the route, declare the
permission, validate the body. Everything else is the service's.

## Patterns to follow

**Pure arithmetic lives in its own file.** Money, points, stock levels and
shift totals are all extracted — `courier-wallet.service.ts` exports
`walletDeltaFor`, `cash.service.ts` exports `shiftDeltaFor`,
`inventory/stock.math.ts` and `customers/loyalty.math.ts` are whole files of
it. These are the functions where an error is silent: nothing crashes, the
numbers are just wrong until somebody counts. Extracted, they are tested
exhaustively without a database.

**Validation is a Zod schema in `packages/validation`,** shared with the forms
that submit to it. A rule cannot drift between what the UI accepts and what the
API accepts.

```ts
@Post()
@RequirePermissions(Permission.PAYMENTS_RECEIVE)
take(@Body(zodBody(createPaymentSchema)) body: CreatePaymentInput) { … }
```

**Cross-module work goes through the event bus, not a direct call,** when the
dependent work must not be able to fail the primary action. Loyalty and
inventory both listen for `ORDER_STATUS_CHANGED` and swallow their own
failures. A direct call would let a bookkeeping error block a sale.

**A transaction wraps anything that writes two related rows.** Taking a payment
writes the payment, the drawer movement and the order's totals, or none of
them.

**Audit anything a person would later ask about.** `audit.record()` for a
create, `audit.recordChange()` for an edit. Never log the secret itself — the
Subo key entry records *that* a key was replaced, not the key.

## Adding a module

1. Create the folder in the shape above.
2. Types in `packages/shared-types/src/models/`, exported from its `index.ts`.
3. Zod schemas in `packages/validation/src/`, exported from its `index.ts`.
4. Permissions — see the checklist in `permissions.md`; it is four steps and
   skipping the last leaves the feature invisible.
5. If it has tables: add them to `schema.prisma`, write the migration SQL by
   hand, and add the model name to `STRICT_TENANT_MODELS` in
   `database/tenant-scope.extension.ts`. Missing that last line is a data leak.
6. Register the module in `app.module.ts`.
7. Add a resource to `packages/api-client/src/resources/` and wire it into
   `client.ts`.

## Errors

`AppException` with a code from `ErrorCode`. Messages that reach a user are
Uzbek.

```ts
throw AppException.notFound('Order', ErrorCode.ORDER_NOT_FOUND);
throw AppException.conflict('Bu kassada ochiq smena bor');
throw new AppException(ErrorCode.SHIFT_NOT_OPEN, 'Smena yopilgan', 409);
```

Use `notFound` rather than `forbidden` when confirming a resource exists would
itself leak something — a courier asking for another courier's delivery gets a
404.

## Logging

pino, structured. Every line carries the request id, tenant and user. The
redaction list in `app.module.ts` covers passwords, tokens, bot tokens and
provider API keys — extend it before logging anything new that is a secret.

```ts
this.logger.log({ orderId, amount }, 'Payment credited');
```
