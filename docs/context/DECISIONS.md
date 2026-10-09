# Decisions

Why the code is shaped the way it is. Each entry exists because the obvious
alternative was tried, considered, or would look reasonable to someone arriving
fresh — and is wrong.

Read this before "simplifying" something that looks over-engineered.

---

## Tenant isolation is enforced below the service layer

A Prisma client extension injects `tenantId` into every query on a scoped
model. Services do not write `where: { tenantId }` and must not.

The alternative — trusting every developer to remember it on every query — has
exactly one failure mode, and that failure mode is one restaurant reading
another's orders.

It **fails closed**: inside a request whose context has no tenant and no
explicit bypass, a scoped query throws. A caller who forgets gets an error, not
somebody else's data.

The known boundary is child tables with no `tenantId` of their own
(`order_items`, `product_ingredients`, `refresh_tokens`). They are reachable
only through a scoped parent, so services must load them via the parent rather
than querying by a raw id.

## The server prices every order

Clients send product ids and quantities. Never prices. The pricing service
reads the live menu, applies promotions, then the promo code, then delivery
rules, and returns the total.

A client that could send a price could buy a pizza for 1 soʻm.

This is also why the POS settles payment against the total that comes *back*
from order creation, not against its own cart estimate: a promotion the till
had not loaded would otherwise leave the order PARTIALLY_PAID with nobody told.

## Money is an integer; stock is a decimal

UZS has no circulating subunit, so money is whole soʻm in an `Int`. No floats,
anywhere, for money.

Stock is the deliberate exception: `NUMERIC(14,3)`. Deducting 0.1 kg three
hundred times has to come to exactly 30 kg, and binary floats do not. Stock
quantities also cross the wire as **strings**, because routing them through a
JSON number reintroduces the drift the column type exists to prevent.

## A stock level moves only through a movement

There is no editable quantity field — not in the API, not on the screen.
Correcting a count is an `ADJUSTMENT` carrying a mandatory reason.

Both the append-only ledger and the running total are kept. That is redundant
on purpose: a level can always be explained, and a disagreement between the two
is itself a finding rather than silent drift.

Levels are allowed to go negative. A level below zero is wrong but real — a
missed delivery, an unrecorded waste — and clamping it to zero hides exactly
the discrepancy a stock-take needs to find.

## Cash and revenue are different things

Three distinctions in the shift arithmetic that look like the same number and
are not:

- A **card sale** is revenue that never enters the drawer. Adding it to
  `expectedCash` makes every shift look short by the day's card takings.
- A **courier hand-over** fills the drawer without counting a second sale. That
  sale was counted when the customer paid at the door.
- **Delivery income** is the courier's own earning and never touches the cash
  they are holding for the restaurant. Conflating the two is how a courier
  hands over money they were owed.

## Cash handover is two-sided

A courier declaring cash does **not** move their balance. A cashier has to
confirm receipt first. A one-sided "I handed it over" is a claim, not a
transfer, and the discrepancy between declared and counted is the entire point
of the handshake — so it is recorded, never smoothed over.

## Loyalty and inventory listen; they are not called

Both hook `ORDER_STATUS_CHANGED` rather than being invoked from the order path,
and both swallow their failures with a warning.

A kitchen that cannot complete a sale because the loyalty module is unhappy is
a worse outcome than points that need reconciling. The sale is the business;
the rest is bookkeeping.

## A product with no recipe is simply not tracked

Inventory deduction applies only to products that have ingredients defined.
That is the incremental path: a restaurant can cost its ten busiest dishes
without modelling the entire menu first.

## The Subo webhook is not believed

Subo's callbacks are unsigned, and their own documentation says to treat a
webhook as a signal and read the real status back from `GET /orders/:id`.

So the handler uses the request body for exactly one thing — which payment to
ask about — and acts on Subo's answer. A forged callback achieves nothing
beyond one wasted API call. The smoke test asserts this with a fabricated
`order.paid`.

## A QR token is the guest's only credential

Scanning a table's code is how a guest proves they are sitting at it, and
nothing more is asked. No login, no phone number — a guest who must register
before seeing the menu orders at the counter instead.

The token grants one table at one branch and reaches nothing else. Rotating it
is a deliberate, separate action, because the remedy for a code photographed
onto the internet cannot be a side effect of renaming a table.

## The super admin has a separate surface

`SUPER_ADMIN` gets `PlatformLayout`, not the tenant admin's sidebar. Their
token carries no tenant, so every tenant-scoped nav item would be dead — and a
sidebar full of links that cannot work is worse than clutter.

## Permissions are checked by code, never by role name

`@RequirePermissions(Permission.ORDERS_REFUND)`, never `if (role === 'OWNER')`.
Roles are bundles of permissions that a restaurant can recombine; a role name
in a condition freezes that bundle forever.

## `getPaginated`, not `get<Paginated<T>>`

The response envelope splits a page: rows in `data`, counters in
`meta.pagination`. A plain `get<Paginated<T>>` returns the bare array while
TypeScript believes it holds `{ items, pagination }` — `.items` is `undefined`,
`?? []` swallows it, and every list renders empty with no error anywhere.

That shipped once. Four tests now pin the contract.

## Absolute URLs go through `apiUrl()`

Everything is served under `/api/v1`. The Subo callback URL was once advertised
without it, which would have sent every payment callback to the static site for
a 405. One exported constant now feeds both `main.ts` and anything building a
URL back to the API.

## Smoke tests run against a live server

Unit tests cover pure arithmetic — money, points, stock, shift totals. Anything
touching the database, the tenant extension or a real HTTP round trip is a
PowerShell smoke test run against the deployed API.

They are ASCII-only because PowerShell 5.1 reads `.ps1` as ANSI, and a Uzbek
apostrophe in one breaks the parse before it runs.
