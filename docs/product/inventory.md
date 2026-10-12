# Inventory

Module: `backend/src/modules/inventory`.
Admin screen: `apps/admin-web/src/pages/InventoryPage.tsx`.

## Three rules

**Stock is per branch.** Flour in Chilonzor cannot be used by Yunusobod. One
pooled figure would let a branch sell a dish it has no ingredients for, which
is worse than not tracking at all.

**A level moves only through a movement.** There is no editable quantity — not
in the API, not on the screen. Correcting a count is an `ADJUSTMENT` carrying a
mandatory reason. Both the append-only ledger and the running total are kept,
so a level can always be explained and a disagreement between them is itself a
finding.

**Deduction never blocks a sale.** Consumption is driven by the order-status
event and every failure is logged and swallowed. A product with no recipe is
simply not tracked — the incremental path that lets a restaurant cost its ten
busiest dishes without modelling the whole menu.

## Tables

| Table | Holds |
| --- | --- |
| `suppliers` | Who the restaurant buys from |
| `stock_items` | One tracked item at one branch: level, threshold, unit cost |
| `stock_movements` | Append-only ledger, signed quantities; a receipt may carry a use-by date and batch code |
| `product_ingredients` | What one unit of a product consumes |
| `supplier_orders` | Purchase orders: snapshotted lines, server-side estimate, Telegram status |
| `stock_takes` | Saved stock-take acts: counted vs the books, per line |

Quantities are `NUMERIC(14,3)` and cross the wire as **strings**. Deducting
0.1 kg three hundred times must come to exactly 30 kg, and binary floats do
not; a JSON number would reintroduce the drift the column type prevents.

## Movement types

`directionOf()` and `signedQuantity()` in `stock.math.ts`.

| Type | Direction | Written by |
| --- | --- | --- |
| `RECEIPT` | + | A person, recording a delivery |
| `CONSUMPTION` | − | **The system**, when an order completes |
| `WASTE` | − | A person. Reported separately — waste is what a manager acts on |
| `ADJUSTMENT` | signed | A person, with a reason. A stock-take can find more *or* less |
| `TRANSFER_OUT` / `TRANSFER_IN` | − / + | A person |

`CONSUMPTION` is refused from the manual endpoint. A hand-posted one would let
anyone make stock disappear with no sale behind it.

`ADJUSTMENT` carries its own sign — forcing a direction would make one of the
two stock-take outcomes impossible to record.

## Endpoints

```
GET    /stock/summary      ?branchId&days   low items, shelf value, waste
GET    /stock/items        ?branchId&lowOnly&search
POST   /stock/items        opening balance is written as an ADJUSTMENT
PATCH  /stock/items/:id    name, unit, threshold, cost — never quantity
DELETE /stock/items/:id    soft
GET    /stock/movements    ?stockItemId&branchId&type
POST   /stock/movements    the manual types only

GET    /suppliers
POST   /suppliers
PATCH  /suppliers/:id

GET    /products/:id/recipe   ingredients, cost, margin
PATCH  /products/:id/recipe   replaced wholesale

GET    /stock/items/:id/insight   7-day usage, days of stock left, dishes, last supplier
GET    /stock/batches      ?branchId&stockItemId   dated batches with stock left
GET    /stock/takes        ?branchId
POST   /stock/takes        counted lines; differences become ADJUSTMENTs

GET    /supplier-orders    ?branchId&status
POST   /supplier-orders    quantities only — the estimate is the server's
POST   /supplier-orders/:id/receive   what arrived → RECEIPTs, one transaction
POST   /supplier-orders/:id/cancel
POST   /supplier-orders/:id/resend    after the supplier's chat was added
```

Every list is filtered by the caller's branches (`BranchScope`).

## Batches and use-by dates

A batch is not a table. A `RECEIPT` carries `expiresAt` and `batchCode`, and
what is left of each batch is **estimated first-in first-out** from the
current level (`remainingByReceipt` in `stock.math.ts`): the level belongs to
the newest receipts, and anything older than it covers is taken as used.

Stored per-batch balances would be a guess dressed up as a figure:
consumption is written per order and cannot know which batch the cook reached
for. FIFO is how a kitchen is supposed to work anyway, and the estimate is
labelled as one on the screen.

Writing off an expiring batch is an ordinary `WASTE`, pre-filled with the
estimated quantity; the person confirms what is actually on the shelf.

## Purchase orders and Telegram

A supplier may have a `telegramChatId` — usually a group with the supplier
and the restaurant's own bot, whose id the bot answers to `/id`. Creating an
order posts it there through the notifications queue (`template:
supplier.order`). The message lists **quantities only**: the restaurant's
estimate is its own business, and the supplier's invoice is what counts.

The order is saved whether or not the message goes out. `telegramStatus` is
`QUEUED`, `NO_CHAT` or `NO_BOT`, and the rendered text is returned so staff
can paste it by hand.

Clients never send a price on an order. The estimate is each item's last
known cost. Receiving takes the **invoice** cost per line, which — like any
receipt — becomes the item's `costPerUnit`. Receiving is all-or-nothing, only
for items that were on the order, and only once.

Order numbers are sequential per tenant, taken under a transaction-scoped
advisory lock so two orders created together cannot share one.

## Stock-takes

Staff type what they counted; blank lines are not counted and not touched.
The server locks the counted rows (`SELECT … FOR UPDATE`), reads the books at
that moment, writes an `ADJUSTMENT` for each difference with the expected and
counted figures in its reason, and stores the act. The figure on the screen
is only a guide: a sale finishing mid-count must not show up as a shortage.

The act prints on A4 with signature lines.

Levels **may go negative**. A level below zero is wrong but real — a missed
delivery, an unrecorded waste — and clamping it hides exactly the discrepancy
a stock-take needs to find.

The running total is incremented in SQL, not read-modify-written: two
deliveries arriving at the same moment would otherwise each read the same
starting figure and one would be lost.

## Recipes and automatic deduction

A recipe says what **one unit** of a product consumes, in the stock item's own
unit. Replaced wholesale on save — a partial update would leave an ingredient
the user deleted still consuming stock.

When an order reaches `DELIVERED`:

1. `consumptionFor()` multiplies each recipe by its line quantity and
   **merges lines sharing a stock item** — two dishes each using 200 g of
   cheese produce one deduction of 400 g, not two rows racing to update the
   same level.
2. Each total is written as a `CONSUMPTION` movement linked to the order, and
   the level is decremented, all in one transaction.
3. Idempotent: a replayed event finds movements already recorded for that
   order and stops.

Only ingredients whose stock item belongs to the order's branch are touched.

## Cost and margin

`GET /products/:id/recipe` returns the ingredient cost of one serving and the
margin against the selling price. A `RECEIPT` with a unit cost updates the
item's `costPerUnit` — a delivery is the freshest price information there is,
so it becomes the basis for valuation and margins.

## Permissions

`inventory.view` and `inventory.manage`. Deliberately not split finer: a
storekeeper who records a delivery is the same person who corrects a level
after a stock-take, and a recipe is what makes the deduction happen at all.

Granted to OWNER, COMPANY_ADMIN and BRANCH_MANAGER (a branch manager runs the
shelf). FINANCE gets `inventory.view` only — shelf value is a balance-sheet
number, but moving stock is not finance's work.

These were added after the original role seed, so they were granted on the
server with SQL. A new tenant gets them from the seed.

## Tests

- `backend/tests/unit/stock-math.spec.ts` — 15 tests on the arithmetic
- `backend/tests/unit/procurement.spec.ts` — the FIFO estimate, use-by days,
  and the supplier message (quantities only, every value escaped)
- `backend/tests/inventory-smoke.ps1` — 24 live checks, including that ten
  wastes of 0.1 against 13.5 leaves exactly 12.500, and that ordering three
  servings of a 0.2 kg recipe removes exactly 0.6 kg
