# Tables and QR service

Module: `backend/src/modules/tables`.
Admin screen: `apps/admin-web/src/pages/TablesPage.tsx`.

A guest scans the code on their table, sees the menu, orders, and calls a
waiter. No account.

## The security model

The QR token is all of it, and it is deliberately thin.

Scanning a table's code is how a guest proves they are sitting at it, and
nothing more is asked. No login, no phone number — a guest who must register
before seeing the menu orders at the counter instead.

What the token grants: **one table at one branch**. It reaches no other table,
no other order, and nothing belonging to the restaurant.

24 random bytes, base64url. Long enough that guessing is not a strategy, short
enough to survive being printed on a table tent.

## Guest endpoints — public

```
GET  /t/:token         resolve to table, branch and any open order
POST /t/:token/call    type: CALL_WAITER | REQUEST_BILL
```

Both `@Public()`, both run unscoped and derive the tenant from the token
itself — the one thing the guest demonstrably holds.

`GET /t/:token` returns an `openOrderId` when the table already has one, so a
second scan **rejoins** the existing order rather than starting a parallel one
for the same group.

Refused for: an unknown token, an inactive table, an inactive branch, a
suspended tenant.

## Staff endpoints

```
GET    /tables              ?branchId
GET    /tables/floor        ?branchId (required) — the live floor, see below
PUT    /tables/layout       { items: [{ id, x, y, shape? }] } — all or nothing
POST   /tables
PATCH  /tables/:id
DELETE /tables/:id          soft; refused while an order is open on it
POST   /tables/:id/rotate-qr

GET    /waiter-calls        ?branchId&status — open ones, oldest first
POST   /waiter-calls/:id/acknowledge
POST   /waiter-calls/:id/resolve

GET    /reservations        ?branchId&from&to (ISO, at most 31 days) &tableId
POST   /reservations
PATCH  /reservations/:id    edit, or move the status on
```

Every one of these is filtered by the caller's branches (`BranchScope`), so a
branch manager cannot read or move another branch's tables.

## The floor plan

Each table has `layoutX`, `layoutY` and `shape` (`SQUARE`, `ROUND`, `RECT`).
Coordinates are the table's centre in plan units of a **1000 × 625** canvas
(`FLOOR_PLAN` in shared-types), one canvas per zone, so a layout reads the same
on a tablet and a monitor.

A table never placed has null coordinates; the admin draws those in a grid
until someone opens the editor and saves. Moving a table to another zone
clears its coordinates — they mean nothing on another floor.

`GET /tables/floor` returns, per table, the open dine-in order (number, total,
item count, who opened it), open waiter calls, and the booking that holds it —
guests seated on one, or the next booking starting within three hours (a late
party keeps its table for 30 minutes). Plus today's completed dine-in revenue
and booking count, in the branch's day. The board polls it every 15 seconds.

## Reservations

`BOOKED → SEATED → COMPLETED`, or `BOOKED → CANCELLED / NO_SHOW`. The last
three are final; a closed booking cannot be edited.

**No double bookings.** Two parties promised the same table at the same hour
is the one failure a host cannot fix at the door, so the server refuses a
booking whose slot overlaps another `BOOKED`/`SEATED` one on that table (409,
naming the other guest and time). Intervals are half-open: one party may
follow another at the minute it leaves.

A booking may be taken without a table — hosts often seat by party size on the
night — and is checked when a table is given to it. Seating needs a table.

Guest name and phone are snapshotted, not linked to a customer: most bookings
come by phone from someone who has never ordered. Bookings starting more than
an hour ago are refused, which leaves room to record a walk-in.

Seating a booking does not open an order — the order is still taken at the
till or by QR, as for any dine-in guest.

### Rotating a QR

Its own endpoint, not a side effect of editing a table. A photographed code
posted online lets anyone open orders on that table from anywhere, and the
remedy has to be one deliberate button.

Every printed code for that table stops working immediately.

The audit entry records **that** codes were invalidated, not the tokens —
a log containing the new token is a log that can reactivate the leak.

### Table numbers are free text

Real floor plans have `12a`, `VIP-2` and `Terrassa 3`. Forcing integers makes
staff invent a mapping they then have to remember. Unique per branch.

`zone` groups the floor the way staff talk about it: terrace, second floor,
VIP.

## Waiter calls

**Repeat taps collapse.** A guest pressing three times is impatient, not three
guests, and three identical rows is noise that teaches a waiter to stop
looking at the screen. An open call of the same type at the same table is
returned as-is.

**Handling is two steps.** Acknowledge ("ketdim") then resolve ("bajarildi").
With one button a second waiter cannot tell whether a call is being walked to
or has been ignored for four minutes.

`CALL_WAITER` and `REQUEST_BILL` are separate calls — a guest can have both
open.

The admin board polls every ten seconds and shows how long each has waited.
A table with an open call gets an amber border so it is findable across a
floor plan of forty.

## The QR image

Fetched from a public generator rather than bundling an encoder — it is
printed once per table and never rendered at scale.

The URL it encodes is built **server-side** (`StockItem`-style, in
`tables.service.ts` from `config.customerWebUrl`) so a printed code cannot
point at a stale path.

## Permissions

`tables.view`, `tables.manage`, `waiter_calls.handle`, `reservations.manage`.
There is no separate view permission for calls — `waiter_calls.handle` covers
reading the queue.

`reservations.manage` is separate from `tables.manage` because answering the
phone should not come with re-issuing QR codes. Cashiers and the call centre
hold it; reading bookings needs it or `tables.view`.

## Tests

`backend/tests/tables-smoke.ps1` — 24 live checks, including that a rotated
token kills the old one, that a deactivated table stops resolving, and that a
guest with no token and no tenant header still gets exactly their own table.

`backend/tests/unit/reservations.spec.ts` — the clash rule and the status
moves.
