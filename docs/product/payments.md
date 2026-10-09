# Payments and the till

Modules: `backend/src/modules/payments`, `backend/src/modules/cash`.
App: `apps/pos`.

Online payment through Subo has its own doc: `../integrations/subo.md`.

## The shape of it

Two things that look like one and are not:

- A **payment** records that a customer paid. It belongs to an order.
- A **cash transaction** records money physically entering or leaving a
  drawer. It belongs to a shift.

A card sale is a payment with no cash transaction. A courier hand-over is a
cash transaction with no payment — the payment happened at the door, hours
earlier. Keeping them separate is what lets both the ledger and the drawer be
right at once.

## Cash shifts

The till is gated behind an open shift. Cash taken outside one belongs to
nobody and reconciles against nothing.

```
POST /cash/shifts/open      branchId, openingCash
GET  /cash/shifts/current   ?branchId
GET  /cash/shifts/:id/summary    X-report: figures so far, shift stays open
POST /cash/shifts/:id/close      actualCash, comment
POST /cash/shifts/:id/transactions   manual CASH_IN / CASH_OUT only
```

One open shift per register. `cashRegisterId` is optional on open — with one
register per branch the server resolves it, and creates a default register
rather than blocking a cashier at 8am over a setup row nobody made.

Scoped by **branch**, not by terminal: a cashier who moves to the second till
mid-service is still working the same shift.

### Closing

`actualCash` is what was counted. The difference is stored as-is, shortage
included. Correcting the expected figure to match the count would erase the
only information the process exists to produce.

The close screen shows the expected figure *before* the cashier types their
count. That is a deliberate trade — hiding it gives a cleaner audit, but a
cashier who cannot see the target has no way to spot their own miscount, and
every small difference becomes an investigation.

### The arithmetic

`shiftDeltaFor(type, method, amount)` in `cash.service.ts`, pure and tested.

```
expectedCash = openingCash + cash sales − cash refunds
             + cashIn − cashOut + handovers − withdrawals
```

Three distinctions that are easy to collapse and must not be — see
`../context/DECISIONS.md`:

| Movement | Drawer | Takings |
| --- | --- | --- |
| Cash sale | + | + |
| Card / terminal sale | — | + (cardTotal) |
| Online sale | — | + (onlineTotal) |
| Bonus redemption | — | — |
| Courier hand-over | + | — |
| Cash refund | − | refundTotal |
| Card refund | — | refundTotal |

A `BONUS` tender reaches none of the three: points are not money taken.

## Taking payment

```
POST /payments          orderId, method, amount, tendered?, cashShiftId?
POST /payments/mixed    orderId, parts[], cashShiftId?
POST /payments/refund   orderId, amount, reason, cashShiftId?
GET  /payments/order/:orderId
```

**Mixed payment is one atomic write.** 100 000 cash plus 56 000 card is two
payment rows in one transaction — two separate calls leave a window where the
order is half paid and a crash loses the rest.

**`paidTotal` is never set directly.** Every increment happens in the same
transaction as the payment row that justifies it, so a reconciliation that sums
payments always matches the order.

**Cash needs a shift; card does not.** An online payment taken at midnight has
no cashier. Cash without a shift is refused.

**The order is credited with what it costs, never with the banknote.** A
cashier types what the customer handed over so the POS can compute change; the
payment is the amount owed.

### Order payment status

`paymentStatusFor(total, paidTotal, refundedTotal)` in `payments.service.ts`.

| State | When |
| --- | --- |
| `PAID` | Nothing owed — including a total of zero |
| `PARTIALLY_PAID` | Something paid, not all |
| `UNPAID` | Nothing paid and something owed |
| `PARTIALLY_REFUNDED` | Some of it came back |
| `REFUNDED` | All of it did |

An overpayment is `PAID` — change owed is the cashier's business, not the
order's status. A fully discounted order is `PAID`, or the POS would demand a
payment of zero before releasing the food.

### Refunds

Recorded as their own rows, never by reducing the original payment. The
original charge happened; erasing it destroys the trail a dispute needs. The
refund goes back on the tender it came in on where that can be determined.

## Courier cash

A delivery paid at the door produces a payment row with `cashShiftId: null` —
the money is real and the order is settled, but it is in the courier's pocket.
It joins a drawer at hand-over, which is a separate `COURIER_HANDOVER`
movement. See `couriers.md`.

## Permissions

`payments.view`, `payments.receive`, `payments.refund`, `cashbox.open_shift`,
`cashbox.close_shift`, `cashbox.view_all_shifts`.

## Tests

- `backend/tests/unit/cash-shift.spec.ts` — the drawer arithmetic
- `backend/tests/unit/payment-status.spec.ts` — status and tiyin conversion
- `backend/tests/payments-smoke.ps1` — 33 live checks
