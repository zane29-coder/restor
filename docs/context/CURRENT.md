# Where the project stands

Last updated: 2026-10-13.

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

`/start` has been pressed by a human: the greeting and the button arrived, and
the Mini App opened.

### Then the Mini App turned out to be broken, and now is not

Opening it showed one line — *"A referenced record does not exist"*. Mini App
sign-in had **never** worked: `loginWithTelegram` writes a session row with
`userId = customer.id`, and `refresh_tokens.userId` is a foreign key to
`users`. Every attempt since the feature was written died on that constraint.
It was listed above as verified by hand, which it cannot have been.

`refresh_tokens` now belongs to a user **or** a customer (migration
`20261010090000_customer_sessions`, a CHECK enforces exactly one). Verified
against production: the insert that used to fail is accepted, a staff session
still is, and a row owned by nobody or by both is refused.

### The bot no longer needs BotFather

A persistent reply keyboard — `🍽 Menyu` (Mini App), `🧾 Buyurtmalarim`,
`📍 Filiallar`, `📞 Aloqa` — and saving a token now also pushes the command
list, the menu button and the descriptions. Pasting the token into Admin →
Telegram is the entire setup; @BotFather is only used to create the bot.

**Still owed:** nobody has completed an order through the Mini App. Sign-in is
fixed and proven at the database level, and the bot answers — but the menu,
cart and checkout inside the Mini App have still never been driven by a human,
because until today nobody could get past the login screen.

`TELEGRAM_MINI_APP_URL=https://tg.restor.uz` is now set on the server and has
to stay. Left unset it derives `{CUSTOMER_WEB_URL}/tg` = `restor.uz/tg`, which
the storefront's SPA fallback answers with the **storefront** — so `/start`
would hand the customer the wrong app with no error anywhere.

Note for anyone who remembers the old instructions: `getUpdates` in a browser
no longer works for finding a chat id. Telegram serves a webhook or
`getUpdates`, never both. Send `/id` in the group instead.

## Admin panel redesign — 2026-10-12/13

The restaurant admin (not the super-admin surface) was rebuilt page by page to
the Stitch designs in `google_stitch/`, with the project logo in place of the
"RESTOR" text and icon. One commit per page, from `162a608` (dashboard) to
`1142dde` (Telegram). Decorative parts of the designs ("ERP v4.2", "1C",
"QQS 12%", fake latency, AI tips) were dropped, not imitated.

New behaviour that came with it, each with its own migration:

| Area | What | Migration |
| --- | --- | --- |
| Branches | Daily revenue target; polygon delivery zones priced by zone | `20261012090000`, `20261012100000` |
| Couriers | Auto-dispatch per branch | `20261012110000` |
| Customers | Staff notes, segments | `20261012120000` |
| Tables | Floor-plan positions and shapes; reservations with a clash check; `reservations.manage` | `20261012130000` |
| Inventory | Batches with use-by dates (FIFO estimate), supplier orders posted to Telegram, stock-take acts | `20261013090000` |
| Mini App | Accent colour, menu banner, map-pin rule | `20261013100000` |

Reports gained recipe-based margins and a Z-report ledger, and — a real fix —
reports, tables, inventory and calls now filter by the caller's branches when
no branch is asked for, instead of returning the whole tenant.

**After deploying past `117cf1f`, run `npm run db:sync-roles` on the server**
(`docs/operations/deploy-standalone.md`): `reservations.manage` is a new
permission and no existing role row has it until then — even owners get 403 on
bookings. Staff must sign in again afterwards.

Verified: 366 backend unit tests; every page clicked through in a browser
against local seeded data; each new endpoint exercised against the local API
(zone pricing, auto-dispatch end to end, reservation clashes, supplier order
receive/cancel, stock-take under row locks, recipe costing, storefront
settings). **Not** verified against production, and the Mini App banner and
map-pin prompt were typechecked but not seen inside Telegram.

Deliberately not built: a multi-language Mini App (the design shows uz/ru/en).
It would mean translating every screen and the menu, which has no translated
fields, against the "Uzbek in the UI" rule. SMS and staff shifts/leave/PIN
were left out by choice.

## What has NOT been verified

**The till, KDS, storefront and courier app have not been driven in a
browser.** The APIs behind every screen are covered and the admin panel has
been clicked through (above); the rest were typechecked, built and deployed,
but nobody has clicked through them. The most valuable thing a human can do
next is one real sale at the till: open a shift, sell, take payment, print,
close against a count.

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
| Multi-language Mini App | Uzbek only, by the project rule — see the redesign section |

## Housekeeping owed

- Seven tenants exist in production; only `demo` is real. The rest are
  `isolation-test-*`, `courier-isolation-*` and `osh-markazi-*` left by
  isolation tests. There is no delete-tenant endpoint, so removing them means
  SQL.
- `tenantId` appears twice in some pino log lines. Cosmetic, both values
  identical.
