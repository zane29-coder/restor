# Testing

Two layers, split on purpose.

**Unit tests** cover pure arithmetic — the functions where an error is silent.
Nothing crashes when money, points, stock or shift totals are wrong; the
numbers are simply wrong until somebody counts. No database, milliseconds.

**Smoke tests** cover everything that needs a real database, the tenant
extension or an HTTP round trip. They run against the deployed API, in
PowerShell, because that is what is actually installed on the machine this is
developed from.

## Unit tests

```bash
cd backend && npm test                      # 217
cd packages/api-client && npx jest          # 4
```

| File | Covers |
| --- | --- |
| `cash-shift.spec.ts` | Drawer vs takings, every movement type |
| `payment-status.spec.ts` | Order payment state, tiyin conversion |
| `courier-wallet.spec.ts` | `balance = received − handed − expenses` |
| `loyalty-math.spec.ts` | Earning, the three redemption ceilings |
| `stock-math.spec.ts` | Movement direction, recipe merging, thresholds |
| `delivery-pricing.spec.ts` | Free zones, per-km, free-above-amount |
| `promotion-value.spec.ts` | Percentage vs fixed coherence |
| `order-status.spec.ts` | The transition machine |
| `rbac.spec.ts` | Permission resolution |
| `request-context.spec.ts` | `runUnscoped` and the ALS scope |
| `telegram-message.spec.ts` | HTML escaping, field markers |
| `telegram-bot.spec.ts` | Command parsing, reply escaping, webhook URL and secret |
| `api-url.spec.ts` | Absolute URLs carry `/api/v1` |
| `pagination.spec.ts` | The split envelope |

The pattern: export the arithmetic as a pure function and test it
exhaustively. `walletDeltaFor`, `shiftDeltaFor`, `paymentStatusFor`,
`deliveryFeeFor`, `pointsEarned`, `maxRedeemable`, `consumptionFor`. If a new
feature computes money, extract the computation first.

## Smoke tests

```powershell
powershell -NoProfile -File backend\tests\payments-smoke.ps1
```

| Script | Checks |
| --- | --- |
| `payments-smoke.ps1` | 33 |
| `reports-smoke.ps1` | 28 |
| `crm-smoke.ps1` | 25 |
| `tables-smoke.ps1` | 24 |
| `inventory-smoke.ps1` | 24 |
| `marketing-smoke.ps1` | 21 |
| `multitenancy-smoke.ps1` | 21 |
| `courier-profile-smoke.ps1` | 17 |
| `delivery-pricing-smoke.ps1` | 13 |
| `telegram-smoke.ps1` | 12 — the bot webhook exists, is public, refuses a forgery |
| `smoke.ps1` | the Phase 1–3 surface |

`telegram-smoke.ps1` cannot cover an actual `/start`: the webhook secret is an
HMAC of a server-side key, so no client can forge a delivery. It asserts the
route is there and guarded; pressing the button is a human step.

### Rules these follow

**ASCII only.** PowerShell 5.1 reads `.ps1` as ANSI; a Uzbek apostrophe or an
em-dash breaks the parse before the script runs.

**Clean up in a `finally`.** They run against production data. Create, assert,
restore — the delivery-pricing script rewrites a branch's rules and puts them
back, and the marketing one deletes what it made.

**Assert the behaviour, not the state of the server.** A test demanding that
no Subo key is configured had to be un-configured to pass, which is a test
that gets deleted rather than fixed.

**No wildcard where the bug would be.** A URL assertion matching
`https://*/webhooks/subo` passed against both the correct URL and the broken
one. If a pattern's wildcard sits exactly where a defect could hide, it proves
nothing.

**`@()` around a filtered pipeline.** PowerShell unwraps a single result and
`.Count` on a bare object is empty, which reads as a failure that is not one.

### Running them all

Running nine back-to-back trips the API rate limiter. Either space them ~60
seconds apart or run the one you need. `RATE_LIMITED` in the output means the
limiter is working, not that the feature is broken.

## Before shipping

```bash
npm run build:packages
npm run typecheck          # every workspace
cd backend && npm test
```

Then deploy, then run the smoke test for whatever changed. A deploy is not
finished until something has been asserted against the live server — twice in
this project a change typechecked, built, deployed and was still wrong.

## What is not covered

**No browser tests.** Every screen's API is covered; no screen has been
clicked. A rendering bug or a broken button would not be caught by anything
here.
