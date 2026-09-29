# Order flow

---

## The rule

**A client sends what was ordered, never what it costs.**

```
Client                                 Server
──────                                 ──────
productId, variantId, quantity,   →    reads the live menu
modifierIds                            applies branch price overrides
                                       validates modifier selections
                                       applies promotions and the promo code
                                       computes the delivery fee
                                  ←    the authoritative total
```

A tampered client cannot buy a pizza for 1 UZS, and the POS, the Mini App and
the storefront cannot disagree about a price — there is exactly one pricing
implementation, in `OrderPricingService`.

---

## Pricing, step by step

### 1. Line prices

Precedence: **branch override → discount price → list price**.

```
unitPrice = max(0, basePrice + variant.priceDelta)
lineTotal = unitPrice × quantity + modifiers × quantity
```

The variant delta is signed — a Small pizza is cheaper than the base — and
clamped at zero so a misconfigured negative delta cannot produce a negative
price.

### 2. Availability

A product that is unavailable or stop-listed at this branch is rejected with
`PRODUCT_UNAVAILABLE`. The menu endpoint already filters these out, so hitting
this means the item ran out between browsing and checkout.

### 3. Modifier validation

Each group's `minSelect`/`maxSelect` is enforced server-side. A "choose exactly
one sauce" group cannot end up with three because someone posted directly.

Modifier ids that belong to another product are **rejected**, not ignored —
silently dropping them would hide a client bug while charging the wrong amount.

### 4. Promotions

Evaluated in priority order against the branch, products, categories, minimum
order, weekday and time window. The first **exclusive** promotion that applies
wins and stops the loop; non-exclusive ones stack. The total is capped at the
subtotal.

### 5. Promo code

Applied to the **already-discounted** subtotal, so a 20% promotion plus a 20%
code cannot exceed 40%. Checks expiry, branch, minimum order, global usage
limit and per-customer limit.

### 6. Delivery fee

Only for `DELIVERY`. The address is checked against the branch's radius using
straight-line distance — deliberately conservative, since real driving distance
is always longer. Without coordinates the order is still accepted, with a
warning for the dispatcher.

### 7. Total

```
total = (subtotal − discounts) + deliveryFee
```

`POST /orders/preview` returns exactly this breakdown, from the same code path
that prices the real order. What the customer confirms is what they are
charged.

---

## Creating an order

One transaction:

1. Reserve the next branch number (atomic `INSERT … ON CONFLICT … RETURNING`)
2. Insert the order, its items and their modifiers
3. Write the first `order_status_history` row
4. Record the promo-code redemption and bump its counter
5. Create the `deliveries` row for a delivery order

Steps 4 and 5 are inside the transaction on purpose: a rolled-back order must
not consume a promo redemption.

Then, outside the transaction, `order.created` is emitted — the kitchen creates
tickets and the realtime gateway pushes to subscribed screens.

### Idempotency

`clientUuid` is generated **before** the first attempt. Replaying it returns
the original order:

- a pre-check for the common case,
- `@@unique([tenantId, clientUuid])` to close the race between two concurrent
  replays, caught as `P2002` and resolved to the existing order.

This is what makes the POS offline queue safe (TZ §18).

---

## Status machine

```
NEW ──► ACCEPTED ──► PREPARING ──► READY ──┬──► WAITING_COURIER
 │         │             │            │     │         │
 │         │             │            │     │    COURIER_ASSIGNED ⇄ WAITING_COURIER
 │         │             │            │     │         │
 │         │             │            │     │    ON_DELIVERY
 │         │             │            │     │         │
 │         │             │            └─────┴──► DELIVERED ──► REFUNDED
 └─────────┴─────────────┴──────────────────────► CANCELLED
```

Defined once in `ORDER_STATUS_TRANSITIONS`
([`packages/shared-types/src/enums.ts`](../packages/shared-types/src/enums.ts))
and read by the backend *and* every client — so the admin panel cannot offer a
move the API will reject.

Notable rules:

- Pickup and dine-in finish at `READY → DELIVERED`; delivery takes the courier
  path.
- A courier can hand a job back: `COURIER_ASSIGNED → WAITING_COURIER`.
- A delivered order **cannot** be cancelled — money has changed hands, so the
  correct action is `REFUNDED`.
- `CANCELLED` and `REFUNDED` are dead ends.
- Cancelling requires a reason, which goes to the audit log.

Each transition appends to `order_status_history`, giving the timeline the spec
asks for (TZ §13). The table is append-only.

Side effects: `DELIVERED` updates the customer's CRM aggregates; `CANCELLED`
releases the promo-code redemption.

---

## Kitchen tickets

Created by reacting to `order.created`, not inline — the kitchen is a consumer
of orders, and a KDS failure must never fail a sale.

With stations configured, items are split by the station that prepares their
category; an item whose category maps to no station goes to an unassigned
ticket rather than vanishing. With no stations, the whole order is one ticket,
which is what a small kitchen wants.

The first station to press START moves the order to `PREPARING`. The order
reaches `READY` only when **every** ticket is ready.

The KDS card's colour band comes from elapsed time — green under 10 minutes,
amber to 20, red beyond — and the elapsed time is always printed as text too,
so colour is never the only signal.

---

## Order numbers

Internal id: UUID. What people say: `CH-1054` — the branch prefix plus a
per-branch counter (TZ §41).

The counter is advanced by one atomic statement inside the order's transaction,
so two tills cannot take the same number and a failed insert returns it rather
than burning it. See [database.md](database.md#order-numbers).

---

## POS offline mode

When the network drops, the till keeps selling (TZ §18):

1. The order is stamped with a `clientUuid` and sent.
2. On a **network** failure it is queued locally and the cashier continues.
3. On reconnect the queue replays oldest-first.
4. Replay is safe because creation is idempotent.

The queue stops at the first network failure — if the link is still down there
is no point burning through the rest. A *server* rejection (a stop-listed
product, say) is permanent, so that entry is dropped and surfaced to the
cashier rather than retried forever.

`localStorage` today; the module is self-contained so a desktop shell can swap
in SQLite without the rest of the app changing.
