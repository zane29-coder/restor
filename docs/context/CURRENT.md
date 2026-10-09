# Where the project stands

Last updated: 2026-10-09.

Keep this file current. It is the first thing an agent reads to know what is
real and what is not, and a stale entry here costs more than no entry.

## Live

`https://restore-1.duckdns.org` — test domain. `restor.uz` is planned and not
yet pointed anywhere.

| Path | App |
| --- | --- |
| `/` | Customer storefront |
| `/admin` | Admin panel, and the super-admin surface under the same origin |
| `/pos` | Till |
| `/kds` | Kitchen display |
| `/tg` | Telegram Mini App |

The courier app is **not** deployed — it is an APK at
`release/restor-courier-0.2.0.apk`, installed on phones by hand.

Seeded sign-ins are listed in `README.md`. Password `Restor2026dev`, restaurant
slug `demo`; SUPER_ADMIN signs in with no slug.

## Built and verified

Every module below has been exercised against the live server, not only unit
tested. The counts are passing smoke-test assertions.

| Area | Checks |
| --- | --- |
| Multi-tenancy (two real restaurants, isolation proven) | 21 |
| Payments and cash shifts | 33 |
| Reports — sales, ABC, finance | 28 |
| Customers and loyalty | 25 |
| Tables and QR service | 24 |
| Inventory, recipes, automatic deduction | 24 |
| Promotions and promo codes | 21 |
| Courier profile, wallet, handover | 17 |
| Delivery pricing rules | 13 |

Plus 173 backend unit tests and 4 api-client tests.

Also working, verified earlier by hand rather than by a smoke suite: the
Telegram bot (order notifications with emoji field markers), the kitchen
display, the storefront and the Mini App.

## What has NOT been verified

**The UIs have not been driven in a browser.** The APIs behind every screen are
covered; the screens themselves were typechecked, built and deployed, but
nobody has clicked through them. The most valuable thing a human can do next is
one real sale at the till: open a shift, sell, take payment, print, close
against a count.

## Blocked on someone else

**Subo online payment.** The merchant key is stored (encrypted, a production
key) and the callback URL is verified reachable. Subo itself returns *"Hech
qanday to'lov provayderi sozlanmagan"* — Atmos, Click and Payme are not
connected to the restaurant's Subo account. Nothing to change on our side; see
`docs/integrations/subo.md`.

## Not built

| Area | State |
| --- | --- |
| Reviews / ratings | No model, no endpoints, nothing |
| Product variants editor | API works; no form in the admin UI |
| Stock transfer between branches | Movement types exist; no UI to pair them |

## Housekeeping owed

- Seven tenants exist in production; only `demo` is real. The rest are
  `isolation-test-*`, `courier-isolation-*` and `osh-markazi-*` left by
  isolation tests. There is no delete-tenant endpoint, so removing them means
  SQL.
- `tenantId` appears twice in some pino log lines. Cosmetic, both values
  identical.
