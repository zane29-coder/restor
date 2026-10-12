# Reports

Module: `backend/src/modules/reports`.
Admin screen: `apps/admin-web/src/pages/ReportsPage.tsx`.

Read-only and stateless. The module owns no tables — every figure is
aggregated from orders, payments and shifts on request. That keeps reports
honest by construction: they cannot drift from the operational data, because
they *are* the operational data.

## Two rules, applied everywhere

**Revenue counts `DELIVERED` orders only.** An order in the kitchen is not
money and a cancelled one never was. `DELIVERED` is the terminal success state
for every order type — a pickup order is marked delivered when the customer
walks away with it.

**Refunds are subtracted, never hidden.** A day with a large refund should
look like one.

Getting these inconsistent between two endpoints is how two screens show two
different revenues for the same day.

## Day boundaries

Resolved at midnight in the **branch's** timezone, not the server's. A report
that starts at 05:00 because the container runs UTC quietly moves five hours
of trade into the wrong day.

That is also why the timeline is bucketed in JavaScript rather than SQL:
Postgres can group by a truncated timestamp but not by a per-branch zone
without threading the zone through the query, and a wrong day boundary is a
wrong report rather than a slow one.

Dates are plain `YYYY-MM-DD`. Accepting an instant would invite a client to
compute midnight itself and get it wrong for a branch in another zone.

## Endpoints

```
GET /reports/dashboard   ?branchId&dateFrom&dateTo
GET /reports/sales       …&granularity=hour|day|week|month
GET /reports/products    …&limit
GET /reports/branches    ?dateFrom&dateTo
GET /reports/promotions  …            (promotions.view)
GET /reports/finance     …            (finance.view)
```

Default range is the last 30 days.

### Dashboard

Headline figures plus change against the preceding window of equal length.
`revenueChangePercent` is `null` when there is no baseline rather than a
misleading zero.

"Online" orders are everything the customer placed themselves — web, bot, Mini
App, QR table — as opposed to a till or a call taken by staff.

### Sales

Revenue split by order type, by source and by tender, plus a timeline.
Discounts and delivery fees are reported separately — the discount total is
what the offers actually cost.

### Cost of goods and margin

`sales` returns `costOfGoods` and `costedRevenue`; `products` returns
`unitCost` and `marginPercent` per dish. The cost is the dish's **recipe** at
current ingredient prices.

Costed **per branch**: a recipe points at stock items, and stock items belong
to a branch, so a burger costs what that branch's shelf says. Revenue a
branch made on a dish it has no recipe for is left out of `costedRevenue`
rather than counted as free — a margin is only ever claimed over what was
actually costed, and the screen says what share of revenue that is.
`costOfGoods` is `null` when nothing sold had a recipe.

### Products and ABC

Ranked by revenue, split at 80% and 95% of the cumulative total.

- **A** — the top 80%. These must never run out.
- **B** — the next 15%.
- **C** — the tail. What a menu can afford to drop.

The split is what a kitchen plans around, which is why it is computed here
rather than left to whoever reads the list.

### Finance

Shift totals and, more usefully, **every closing discrepancy**. The totals
tell an owner how the month went; the list tells them which evening to ask
about.

The reconciliation triple covers **closed shifts only**:

```
expectedCash − countedCash = difference     (always ties)
cashInOpenShifts                            (reported separately)
```

An open shift has nothing counted yet. Including it would show a shortage the
size of the drawer and leave a reader comparing two numbers that disagree with
`difference` for no visible reason. That shipped once — see
`../context/DECISIONS.md`.

Trading totals (`cashSales`, `cardSales`, `onlineSales`) still cover every
shift in the window.

`shifts` is the Z-report ledger: every shift in the window (at most 200,
newest first) with branch, who opened and closed it, expected and counted
cash, and card plus online takings.

## Branch scope

Without a `branchId`, a branch-scoped user gets **their own branches**, never
the whole tenant: every report filters by `BranchScope.filterFor`. Asking for
a branch outside one's scope is refused.

## The admin screen

Tabs: sales and revenue, product profitability (ABC + margin), finance and
cash (behind `finance.view`), branch comparison. `?tab=` and `?branch=` are
read from the URL, which is how the branches page links into it. Comparisons
with the previous period are two server answers side by side; the weekend
insight and month-end forecast are arithmetic on the returned timeline, shown
only when there is enough data for them to mean something.

## Permissions

`reports.view` for sales and products. **`finance.view` for the finance
report** — a shift manager who may read sales has no reason to see every
cashier's shortages.

## Tests

`backend/tests/reports-smoke.ps1` — 28 live checks, including that the
by-type revenue sums to the headline, that payment shares total 100%, that a
cashier is refused the finance report, and that a reversed date range is
rejected.
