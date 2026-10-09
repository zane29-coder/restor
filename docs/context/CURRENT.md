# Where the project stands

Last updated: 2026-10-09.

Keep this file current. It is the first thing an agent reads to know what is
real and what is not, and a stale entry here costs more than no entry.

## Live

`restor.uz` **is** pointed at production now — every name below resolves to
`169.58.84.241`. One sub-domain per app, not the sub-paths this used to serve.

| Host | App |
| --- | --- |
| `restor.uz` | Customer storefront |
| `app.restor.uz` | Admin panel, and the super-admin surface under the same origin |
| `pos.restor.uz` | Till |
| `kds.restor.uz` | Kitchen display |
| `tg.restor.uz` | Telegram Mini App |
| `api.restor.uz` | Backend — `/api/v1`, `/realtime`, `/uploads`, `/health` |

`restore-1.duckdns.org` still answers and 301s each old sub-path to its new
host (`/admin` → `app.restor.uz`). Its `/api/` is still proxied, which is what
keeps the released courier APK working — that APK has the duckdns host baked
in and cannot be repointed without a rebuild.

Health is `/health`, **not** `/api/v1/health`: probes deliberately bypass the
version prefix, so `/api/v1/health` is a 404 on every host and is not a sign of
anything wrong.

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

Plus 217 backend unit tests and 4 api-client tests.

Also working, verified earlier by hand rather than by a smoke suite: the
Telegram bot (order notifications with emoji field markers), the kitchen
display, the storefront and the Mini App.

## The Telegram bot's inbound half — deployed 2026-10-09

**The bot now answers.** It was write-only until then: `setWebhook` sat in the
API client with no call site, no route existed for Telegram to POST to, and
nothing handled a command — so `/start` produced nothing and the token looked
like the culprit. Added: `POST /api/v1/webhooks/telegram/:configId`, `/start`
`/help` `/menu` `/id` handling, a Mini App button, chat-id reporting when the
bot joins a group, automatic webhook registration on save and at boot, and
`GET /telegram/bot/status` behind a **Bot holati** card on the admin screen.

Deployed and confirmed against the real Telegram API:

- the API log says `Telegram webhooks: 1/1 bots registered`;
- `GET /telegram/bot/status` reports `isConnected: true`, 0 pending, no error;
- `telegram-smoke.ps1` — 16/16 against production.

The `demo` tenant's bot is `@njdnsbdabot`, registered at
`api.restor.uz/api/v1/webhooks/telegram/{configId}`.

**Still owed:** nobody has pressed `/start` as a real customer. Everything
asserted above is the plumbing — that the route exists, is guarded, and that
Telegram agrees it should deliver here. The reply itself has not been seen by
a human.

`TELEGRAM_MINI_APP_URL=https://tg.restor.uz` is now set on the server and has
to stay. Left unset it derives `{CUSTOMER_WEB_URL}/tg` = `restor.uz/tg`, which
the storefront's SPA fallback answers with the **storefront** — so `/start`
would hand the customer the wrong app with no error anywhere.

Note for anyone who remembers the old instructions: `getUpdates` in a browser
no longer works for finding a chat id. Telegram serves a webhook or
`getUpdates`, never both. Send `/id` in the group instead.

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
