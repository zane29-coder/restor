# Telegram

Module: `backend/src/modules/telegram`.
Client: `backend/src/integrations/telegram/telegram-api.client.ts`.
Message builder: `backend/src/integrations/telegram/message.builder.ts`.
Admin screen: `apps/admin-web/src/pages/TelegramPage.tsx`.

Three separate things share the name:

1. **The bot** — sends order notifications into staff groups.
2. **The Mini App** — a customer-facing storefront inside Telegram.
3. **Bot sign-in** — authenticating a customer from `initData`.

## The bot

Per tenant, optionally per branch. Each restaurant brings its own token from
@BotFather; there is no platform-wide bot.

```
GET  /telegram/config       ?branchId — state only, never the token
POST /telegram/config       botToken?, defaultChatId?, isActive
GET  /telegram/routes       ?branchId
POST /telegram/routes       event → chat (+ optional forum topic)
GET  /telegram/events       the routable event list
```

The token is AES-256-GCM encrypted at rest and never returned. `req.body.botToken`
is in the pino redaction list. Saving a chat id does not require re-typing the
token — an omitted `botToken` leaves the stored one alone.

### Routing

Per event **and** per branch, which is what lets a chain send Chilonzor's
orders to Chilonzor's group. A branch with no route of its own falls back to
the tenant-wide `defaultChatId`.

Forum topics are supported: a route can carry a `message_thread_id` so new
orders, cancellations and courier events land in separate threads of one
group. `null` posts to General — the field is omitted entirely when unset,
because passing `null` makes Telegram reject the call rather than fall back.

### Delivery

Queued through BullMQ, not sent inline. A Telegram outage must not slow down
order creation.

Retries distinguish the two failure kinds: a network blip is retried, while a
permanent rejection (bot removed from the group, chat deleted) throws
`UnrecoverableError` so the queue stops hammering something that will never
succeed.

### Messages

HTML parse mode. **Every interpolated value goes through `escapeHtml`** — a
customer whose name contains `<` would otherwise break the message or inject
markup.

Emoji **are** used here, as field markers, and this is the deliberate exception
to the no-emoji rule that governs the web UIs. A staff group is a dense feed
read at a glance on a phone; a leading glyph per field is faster to scan than
a label.

```
🚚 Yetkazish   🛍 Olib ketish   🍽 Zalda      🪑 Stolda
🆕 Yangi       ✅ Qabul         🍳 Tayyor...  🛵 Yo'lda
💵 Naqd        💳 Karta         📲 Onlayn     🎁 Bonus
```

Messages are capped at 4096 characters and link previews are disabled — a long
order otherwise gets a preview card appended.

## The Mini App

Served at `/tg`, built from `apps/telegram-mini-app`.

Authentication is `initData` verified by **HMAC-SHA256 server-side** against
the bot token. Never trust a `user` object a client sends; the signature is
the only thing that proves it.

See `../architecture/auth.md` for the exchange.

## Notifications module

`notifications` owns the queue and the delivery record; `telegram` owns the
bot config and the formatting. Other modules emit domain events and neither
knows about them.

Adding a notifiable event: emit the domain event, add it to the routable list,
and give `message.builder.ts` a case. Nothing in the emitting module changes.

## Setup for a restaurant

1. @BotFather → new bot → token.
2. Add the bot to the staff group as an administrator (it cannot post
   otherwise).
3. Paste the token in Admin → Telegram.
4. Add the group's chat id, and routes per event if the defaults are not
   enough.

A token that has been pasted into a chat log should be revoked with
`/revoke` and replaced.

## Permissions

`telegram.view`, `telegram.manage`.
