# Customers and loyalty

Module: `backend/src/modules/customers`.
Admin screen: `apps/admin-web/src/pages/CustomersPage.tsx`.

Customer rows have accumulated since the first order — every phone order
creates or matches one. This module exposes data that was already there.

## Customers

```
GET   /customers            ?search&isBlocked
GET   /customers/:id        includes addresses and loyalty standing
GET   /customers/:id/orders
PATCH /customers/:id        name, email, birth date, language
POST  /customers/:id/block     reason recorded on the audit entry
POST  /customers/:id/unblock
```

**The phone cannot be edited.** It identifies the customer, links their order
history and is how a Telegram account was matched — changing it would graft
one person's history onto another.

**Blocking keeps everything.** History, points, addresses. It stops them
ordering; it is not a deletion. Erasing the record would also erase why they
were blocked, which is the one thing anyone asks about later.

### Search

Matches phone, name and Telegram handle. For the phone it strips separators
and matches the digits — people type `+998 90 123 45 67`, `998901234567`, or
just the last few they remember, and phones are stored normalised to E.164 so
the digits sit contiguously.

The digit path applies **only when the term contains no letters**. `Ali 999`
is a name that happens to carry a number; stripping it to `999` once matched
every phone containing 999 anywhere. See `../context/KNOWN_ISSUES.md`.

### Aggregates

`ordersCount`, `totalSpent`, `averageCheck` and `lastOrderAt` are denormalised
onto the row and updated when an order completes. A list that aggregated
orders per page would table-scan on every search, and a manager does this
lookup while someone is on the phone.

## Loyalty

```
GET   /loyalty/program          defaults to off when never configured
PATCH /loyalty/program          cashback %, point value, max redeem %, expiry
GET   /customers/:id/loyalty
GET   /customers/:id/loyalty/transactions
GET   /customers/:id/loyalty/quote?total=   what points could cover
```

### The arithmetic

`loyalty.math.ts`, pure and tested. Points are a liability the restaurant
carries, so both roundings go the restaurant's way where it costs the customer
nothing.

**Earning rounds down.** `pointsEarned(orderTotal, cashbackPercent)`. Awarding
a fraction of a point compounds across thousands of orders into a liability
nobody agreed to.

**Redemption is capped by three ceilings and the tightest wins:** what the
customer holds, the share of a bill the policy allows, and the bill itself.
Returning more than any one of them would let points pay for an order twice.

A cap that does not divide evenly into whole points is snapped **down** to what
an exact number of points buys — a 12 500 ceiling against a 1 000-soʻm point
spends 12 points for 12 000, not 13 for 12 500.

A request above the ceiling is **trimmed, not rejected**. A stale balance in a
client is not a reason to fail an order at the till; the caller is told what
was actually spent.

### Earning happens on an event

`CustomersService` listens for `ORDER_STATUS_CHANGED` → `DELIVERED` rather
than being called from the order path, and swallows its failures with a
warning. Points are a courtesy; the sale is not.

Aggregates move whether or not a programme is running — they are the
customer's history, not a reward.

### Referral codes

Eight characters, excluding `0/O` and `1/I/L`. These get read off a phone
screen and typed by someone else, and those pairs are where that goes wrong.

## The settings screen

The cashback form shows a worked example underneath: "a 100 000 order returns
5 000 points — worth 5 000 soʻm." Two abstract numbers multiply into a real
cost, and restaurants have given away far more than they intended by not doing
that multiplication.

## Permissions

`customers.view`, `customers.update`, `customers.delete`, `customers.export`,
`loyalty.view`, `loyalty.manage`.

Blocking uses `customers.update` — there is no separate block permission.

## Tests

- `backend/tests/unit/loyalty-math.spec.ts` — 16 tests
- `backend/tests/crm-smoke.ps1` — 25 live checks
