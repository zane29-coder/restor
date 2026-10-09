# Promotions and promo codes

Module: `backend/src/modules/marketing`.
Admin screen: `apps/admin-web/src/pages/MarketingPage.tsx`.

The pricing engine has read these rows since orders existed — see
`orders.md` for where they land in the calculation. This module is the surface
that lets a manager create them.

## The one thing to get right

**`value` means a percentage for one type and an amount of soʻm for another.**

`50` on a `PERCENTAGE_DISCOUNT` is half off. `50` on a `FIXED_DISCOUNT` is
fifty soʻm. A manager who picks the wrong type and keeps the number in their
head creates a promotion that takes every order to zero, and nothing
downstream questions it because both are valid integers.

Three layers guard it:

1. The form relabels the field with the type and validates before submitting.
2. The Zod schema refuses the combination.
3. The service re-checks against the **merged row** on update — a PATCH that
   changes only the type would otherwise sail past a check that sees only the
   patch.

`assertValueMatchesType` and `assertDiscountMatchesType` are exported from
`marketing.service.ts` and tested directly.

## Promotions

Applied automatically. No code to type.

```
GET    /promotions      ?branchId&isActive&search
POST   /promotions
PATCH  /promotions/:id
DELETE /promotions/:id    soft
```

| Type | `value` |
| --- | --- |
| `PERCENTAGE_DISCOUNT` | 1–100 |
| `FIXED_DISCOUNT` | minor units, > 0 |
| `FREE_DELIVERY` | ignored |
| `HAPPY_HOUR` | percentage, within the time window |
| `BUY_X_GET_Y`, `COMBO` | configured in `config` |

Targeting, all optional and all "empty means everywhere":
`branchIds`, `productIds`, `categoryIds`, `daysOfWeek`, `timeFrom`/`timeTo`,
`minOrderAmount`.

A time window needs **both** ends. Half a window would run all day, which is
the opposite of a happy hour.

`priority` orders evaluation, highest first. The first `isExclusive` promotion
that applies stops the loop; non-exclusive ones stack. The total discount can
never exceed the subtotal.

## Promo codes

Typed by the customer.

```
GET    /promo-codes          ?isActive&search
POST   /promo-codes
PATCH  /promo-codes/:id      NOT the code itself
DELETE /promo-codes/:id      soft
GET    /promo-codes/:id/usages
```

| Type | `discount` |
| --- | --- |
| `PERCENTAGE` | 1–100 |
| `FIXED` | minor units |
| `FREE_DELIVERY` | ignored; zeroes the delivery fee |

Upper-cased on the way in. A customer typing `welcome10` means `WELCOME10`,
and being told otherwise reads as a bug.

**The code cannot be renamed.** Customers already have it on a poster or in a
message, and renaming a live code silently breaks every one of them.

Limits: `usageLimit` total, `userLimit` per customer, `minOrderAmount`,
`maxDiscount`, a date range, and `branchIds`. One redemption per order is
enforced by a unique index on `promo_code_usages.orderId`, so a double-submit
cannot discount the same order twice.

## Deleting is soft

Orders priced with a promotion name it in their applied-promotion history. A
finance report that cannot say which discount it is looking at is useless.

## Permissions

`promotions.view`, `promotions.manage`, `promo_codes.view`,
`promo_codes.manage` — promo codes carry their own pair so a marketing
assistant can be trusted with campaign codes without being given the promotion
engine.

## Tests

- `backend/tests/unit/promotion-value.spec.ts` — the type/value coherence
- `backend/tests/marketing-smoke.ps1` — 21 live checks, including that
  creating a promotion actually changes what an order costs and that
  disabling it puts the price back
