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
| `stock_movements` | Append-only ledger, signed quantities |
| `product_ingredients` | What one unit of a product consumes |

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
```

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
- `backend/tests/inventory-smoke.ps1` — 24 live checks, including that ten
  wastes of 0.1 against 13.5 leaves exactly 12.500, and that ordering three
  servings of a 0.2 kg recipe removes exactly 0.6 kg
