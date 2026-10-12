# Delivery and couriers

Module: `backend/src/modules/couriers`. App: `apps/courier-mobile`.
Admin screen: `apps/admin-web/src/pages/CouriersPage.tsx`.

Two controllers with different threat models, and the split is the point:

- `couriers.controller.ts` — the dispatcher and finance side. Permission-gated
  and branch-scoped like any admin surface.
- `courier-app.controller.ts` — the mobile app. **No route here accepts a
  `courierId`.** Every one derives it from the JWT, so a tampered client
  cannot reach another courier's jobs, wallet or cash.

## The courier's app

```
GET   /courier/me                    profile + today's figures
PATCH /courier/me                    contact phone only
GET   /courier/jobs                  unfinished deliveries assigned to me
POST  /courier/jobs/:id/accept       ASSIGNED → ACCEPTED
POST  /courier/jobs/:id/start        ACCEPTED → PICKED_UP, order → ON_DELIVERY
POST  /courier/jobs/:id/complete     PICKED_UP → DELIVERED, credits cash
POST  /courier/jobs/:id/fail         reason required
POST  /courier/status                online / offline / break
POST  /courier/location              GPS ping, 204
GET   /courier/wallet
GET   /courier/wallet/transactions
POST  /courier/handovers             declare cash — does NOT move the balance
GET   /courier/handovers
```

### The contact phone is not the login phone

`Courier.contactPhone` exists because `User.phone` is the login key, unique per
tenant. A courier correcting the number customers ring at the door would
otherwise be changing their own credentials, and one typo locks them out of
the app between deliveries. `null` falls back to the login phone.

### "Today" is the branch's midnight

Not the server's. A courier in Tashkent reading "0 delivered" at 06:00 because
UTC had not rolled over would rightly conclude the app was broken.

### Location

Reported only while on shift and only after the courier grants permission —
tracking someone off shift is neither needed nor acceptable. Throttled to 20
seconds or 50 metres. A dropped ping is swallowed rather than interrupting
them.

## The wallet

`walletDeltaFor(type, amount)` in `courier-wallet.service.ts`, pure and tested.

```
balance = cashReceived − cashHandedOver − expenses
```

| Type | Effect |
| --- | --- |
| `CASH_RECEIVED` | +balance — cash taken at the door |
| `HANDOVER` | −balance — given to a cashier |
| `EXPENSE` | −balance |
| `DELIVERY_INCOME` | **does not touch balance** — the courier's own earning |
| `ADJUSTMENT` | signed |

`DELIVERY_INCOME` is the one to get right. It is what the restaurant owes the
courier, not cash they are holding for the restaurant. Conflating the two is
how a courier hands over money they were owed — which is why the app shows the
two in different colours.

## Cash hand-over is two-sided

A courier declares; a cashier confirms. **Declaring does not move the
balance.** Until confirmation the money is in limbo, and the app keeps showing
it as pending so the courier does not declare it twice.

```
POST /courier/handovers       courier declares (branchId optional — falls
                              back to their assigned branch)
GET  /handovers               the cashier's queue
POST /handovers/:id/confirm   amount? — what was actually counted
```

One open declaration at a time: two pending hand-offs make it ambiguous which
one the cashier is confirming.

A confirmed amount that differs from the declared one is recorded as a
discrepancy and the handover goes `DISPUTED`, not `CONFIRMED`. That difference
is the entire reason the handshake has two sides.

Confirmation writes a `COURIER_HANDOVER` cash transaction through
`CashService.record` — which fills the drawer **without** counting a second
sale. That sale was counted when the customer paid at the door.

## The money trail of a cash delivery

Two honest events, deliberately separate:

1. **At the door** — `complete()` credits the wallet, marks the order paid, and
   writes a `Payment` row with `cashShiftId: null`. The customer has paid; the
   money is in a pocket.
2. **At hand-over** — a `COURIER_HANDOVER` movement puts it in a drawer.

Attaching the payment to a shift at step 1 would put cash in a drawer that does
not contain it.

## Dispatch

```
GET  /couriers                        list with wallet and current load
GET  /couriers/live                   positions for the map
POST /orders/:id/courier              assign
GET  /orders/:id/courier-suggestions  ranked by load, then distance
```

The admin board refreshes on a timer because it is live: a dispatcher reading
a stale "available" and assigning to someone who went offline ten minutes ago
is the failure that avoids. Offline couriers are not offered in the dropdown —
assigning to one produces a job nobody is looking at.

### Auto-dispatch

Per branch, `branches.autoDispatch`, off by default (Admin → Kuryerlar, or
the branch's settings). When on:

- a delivery order reaching `READY` is moved to `WAITING_COURIER` by the
  system, and that event assigns it — two steps through the normal state
  machine, so the timeline reads "Avto-dispatch … Tizim" and the two events
  cannot race into a double assignment;
- a courier switching to `AVAILABLE` in the app picks up the oldest delivery
  waiting at their branch.

The choice is `pickCourier` (pure, `auto-dispatch.spec.ts`): **only
`AVAILABLE` couriers**, least loaded, then nearest. A courier mid-delivery may
be suggested to a human but is never given work by the machine. Nobody free →
the order waits for a dispatcher. Every failure is swallowed with a warning —
dispatch must never fail the kitchen's "ready".

`POST /couriers/dispatch?branchId` is the dispatcher's "Hozir taqsimlash":
the same assignment for every waiting delivery in scope, regardless of the
setting. Listeners run as a system context (no user), so status history
credits "Tizim", not whoever pressed "ready".

## Permissions

`couriers.view`, `couriers.create`, `couriers.update`, `couriers.track`,
`courier_wallet.view`, `courier_wallet.settle`, `orders.assign_courier`.
The app itself uses `deliveries.view_own` and `deliveries.update_own`.

## Tests

- `backend/tests/unit/courier-wallet.spec.ts` — the wallet arithmetic
- `backend/tests/courier-profile-smoke.ps1` — 17 live checks
- `backend/tests/courier-smoke.ps1` — the delivery flow
