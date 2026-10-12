# Telegram

Module: `backend/src/modules/telegram`.
Client: `backend/src/integrations/telegram/telegram-api.client.ts`.
Message builder: `backend/src/integrations/telegram/message.builder.ts` (outbound),
`bot-reply.builder.ts` (inbound).
Admin screen: `apps/admin-web/src/pages/TelegramPage.tsx`.

Three separate things share the name:

1. **The bot** — sends order notifications into staff groups, and answers
   customers who message it.
2. **The Mini App** — a customer-facing storefront inside Telegram.
3. **Bot sign-in** — authenticating a customer from `initData`.

One token does both bot jobs. A restaurant has **one** bot: it posts into the
staff group and it is what a customer opens to order. There is no second token.

## The bot

Per tenant, optionally per branch. Each restaurant brings its own token from
@BotFather; `TELEGRAM_BOT_TOKEN` is a platform-wide fallback used only for
verifying Mini App `initData`.

```
GET  /telegram/config       ?branchId — state only, never the token
PUT  /telegram/config       botToken?, defaultChatId?, isActive
GET  /telegram/bot/status   ?branchId — is it actually connected, and if not why
POST /telegram/bot/connect  ?branchId — re-register the webhook
GET  /telegram/routes       ?branchId
PUT  /telegram/routes       event → chat (+ optional forum topic)
GET  /telegram/events       the routable event list
```

The token is AES-256-GCM encrypted at rest and never returned. `req.body.botToken`
is in the pino redaction list. Saving a chat id does not require re-typing the
token — an omitted `botToken` leaves the stored one alone.

### Inbound — the webhook

`POST /api/v1/webhooks/telegram/:configId`, public, secret-verified.
Handler: `telegram-webhook.controller.ts` → `telegram-bot.service.ts`.

Under `webhooks/` deliberately: nginx exempts that prefix from rate limiting,
the same exemption payment callbacks rely on. The application limiter is
skipped too — it counts per IP, and every update in the world arrives from
Telegram's handful of addresses.

The path carries the **config id**, not the tenant slug: a tenant may also run
a per-branch bot, and one rule then covers both. The matching secret is
**derived, not stored** — `HMAC(base, "telegram-webhook:" + configId)`, where
the base is `TELEGRAM_WEBHOOK_SECRET` or, unset, `ENCRYPTION_KEY`. That
fallback is sound rather than lazy: a bot token cannot be stored without the
encryption key, so wherever a webhook can exist a base for its secret does too.
Telegram echoes the secret in `X-Telegram-Bot-Api-Secret-Token`, and it is
checked before anything in the body is read.

Registration happens in two places, both in `telegram-webhook.service.ts`:
saving a token, and start-up — every active bot is re-pointed at this
deployment on boot, un-awaited so a Telegram outage cannot hold the API off the
network. That is what makes a deploy enough to get a configured bot answering.

What the bot answers:

| Where | Message | Reply |
| --- | --- | --- |
| Private | `/start`, `/menu` | greeting + the persistent keyboard |
| Private | `🧾 Buyurtmalarim` | that customer's last five orders |
| Private | `📍 Filiallar` | branch names, addresses, phones |
| Private | `📞 Aloqa` | the restaurant's number |
| Private | `/help` | what the bot does |
| Private | anything else | a nudge back to the keyboard |
| Group | `/id` | the chat and topic id |
| Group | being added | the chat id, unprompted |
| Group | anything else | **silence** |

Silence in a group is deliberate: a staff group is a work feed, and a bot that
answers chatter there makes it unreadable.

### The keyboard

A **reply** keyboard, not an inline one. An inline keyboard scrolls away with
the message that carried it, so a customer who has sent anything since
`/start` has nothing left to press; this one stays under the message box.

The consequence to remember: a reply-keyboard tap is **not** a callback.
Telegram sends the button's own label as an ordinary message, so the labels in
`BOT_BUTTONS` are the only thing identifying a tap. Change a label in one
place and the button silently stops working — the handler matches on those
constants, and both sides must come from them.

`Menyu` carries the Mini App. On a deployment without TLS that one button is
dropped rather than sent: Telegram rejects the entire `sendMessage` over one
non-HTTPS `web_app` URL, which would cost the customer every other button too.

The bot takes no orders itself. Ordering is the Mini App's job — it already
prices server-side, applies promotions and collects an address; a chat-based
order flow would be a second implementation of all of it.

### Setup is the token, and nothing else

Saving a token does four more things besides registering the webhook:

| Call | Replaces |
| --- | --- |
| `setMyCommands` | `/setcommands` in @BotFather |
| `setChatMenuButton` | `/newapp`, then Bot Settings → Menu Button |
| `setMyShortDescription` | `/setabouttext` |
| `setMyDescription` | `/setdescription` |

`setChatMenuButton` is the one that matters: it is why a restaurant never has
to open @BotFather at all. These are applied with `allSettled` — they are four
independent cosmetic settings and one rejection must not cost the other three
— and each failure is logged on its own.

**`getUpdates` no longer works.** Telegram serves a bot either a webhook or
`getUpdates`, never both, so the browser trick for finding a chat id now
answers 409. The bot reports the ids instead: unprompted when it is added to a
group, and on `/id` afterwards.

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

Served at `/tg` (or `tg.restor.uz` on a sub-domain deployment — set
`TELEGRAM_MINI_APP_URL`), built from `apps/telegram-mini-app`.

Which restaurant it serves comes from the URL: `start_param` first, then
`?tenant={slug}`, then the build-time `VITE_TENANT_SLUG`. That is why the
button the bot sends carries `?tenant=` — the Mini App is one bundle serving
every tenant.

Authentication is `initData` verified by **HMAC-SHA256 server-side** against
the bot token. Never trust a `user` object a client sends; the signature is
the only thing that proves it.

See `../architecture/auth.md` for the exchange.

### Appearance and checkout settings

`storefront_settings` (one row per tenant), edited on the admin Telegram page
under `settings.update`, read publicly through `GET /storefront`:

| Setting | Effect |
| --- | --- |
| `accentColor` | The storefront's accent. Null falls back to the tenant's white-label `primaryColor`, which stays with the platform's branding permission. `GET /storefront` returns whichever applies as `restaurant.primaryColor`, so the Mini App needs no change to honour it |
| `bannerUrl`, `bannerTitle`, `bannerText` | A promo banner under the menu hero; `banner` is null when none is set. The image is uploaded through `files/images` |
| `requireMapPin` | Delivery to a saved address without coordinates is refused at checkout (422). The Mini App says so before submit and sends the customer to pin it |
| `cashEnabled`, `onlineProviders`, `cutleryEnabled`, `leaveAtDoorEnabled` | Unchanged; now editable from the admin as well |

The Mini App stays Uzbek-only: a language switch would mean translating
every screen and the menu itself, which has no translated fields, against
the project rule that the UI is Uzbek.

## Notifications module

`notifications` owns the queue and the delivery record; `telegram` owns the
bot config and the formatting. Other modules emit domain events and neither
knows about them.

Adding a notifiable event: emit the domain event, add it to the routable list,
and give `message.builder.ts` a case. Nothing in the emitting module changes.

## Setup for a restaurant

1. @BotFather → new bot → token. **That is the only BotFather step.**
2. Paste the token in Admin → Telegram (the platform admin does this; a tenant
   admin cannot). Saving it registers the webhook and pushes the command list,
   the menu button and the descriptions. **Bot holati** then says *Bot ulangan*.
3. Press `/start` in a private chat with the bot. A greeting and a keyboard
   with `🍽 Menyu` on it is the whole smoke test.
4. Add the bot to the staff group **as an administrator** — it cannot post
   otherwise. It replies with the group's chat id.
5. Paste that id as the default chat, and add per-event routes if the default
   is not enough.

A token that has been pasted into a chat log should be revoked with `/revoke`
and replaced. Re-entering it in Admin → Telegram redoes all of step 2.

### When the bot does not answer

Read **Bot holati** on the Telegram screen first; it distinguishes the causes
that look identical from the settings alone.

| Symptom | Cause |
| --- | --- |
| *Webhook sozlanmagan* | Nobody registered one. Press **Qayta ulash**. |
| *Bot boshqa serverga ulangan* | The same token is in use by another deployment. Telegram allows one webhook per bot, so the newest registration wins and the loser goes quiet with no error anywhere. **Qayta ulash** takes it back. |
| *Server HTTPS emas* | `API_BASE_URL` is `http://`. Telegram only delivers over TLS, so the bot cannot answer on localhost at all — notifications still work, those are outbound. |
| Pending updates climbing | Telegram is delivering and getting an error back. Its own message is shown under the card. |
| *Saqlangan tokenni oʻqib boʻlmadi* | `ENCRYPTION_KEY` changed. The row survived, the plaintext did not; paste the token again. |

## Permissions

| Permission | Covers |
| --- | --- |
| `telegram.view` | Reading the config and the bot status — a restaurant admin can see the bot is down even though they cannot fix it |
| `telegram.manage` | The token, and connecting the webhook. Platform-only (TZ §6) |
| `telegram.routes.manage` | Event → chat routes, the restaurant's own call |
