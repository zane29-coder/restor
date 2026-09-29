# Telegram Mini App

Ordering inside Telegram (TZ §48). React 18 + Vite.

## Development

```bash
npm install && npm run build:packages    # from the repository root
npm run dev:miniapp                      # http://localhost:5177
```

The app **only works inside Telegram** — outside it there is no `initData` to
verify, and it says so rather than pretending. To test:

1. Expose the dev server: `npx localtunnel --port 5177` (or ngrok).
2. In [@BotFather](https://t.me/BotFather): `/newapp`, point it at the HTTPS URL.
3. Set `TELEGRAM_BOT_TOKEN` in `backend/.env`.
4. Open the Mini App from your bot.

## Build

```bash
npm run build --workspace=@restor/telegram-mini-app
```

## Authentication

This is the whole Telegram integration, and it is worth being precise about:

1. Telegram gives the page a signed `initData` string.
2. The app forwards it **verbatim** to `POST /auth/telegram`.
3. The backend verifies its HMAC against the bot token, checks freshness, and
   only then reads the user.

Nothing in `initDataUnsafe` is trusted for identity — as its name says. It is
used only to theme the UI before the server has answered.

A Mini App user is a **customer**, not staff: the token carries no staff
permissions at all.

## Which restaurant?

1. `start_param` from a deep link — `t.me/yourbot/app?startapp=demo`
2. `?tenant=` in the URL
3. `VITE_TENANT_SLUG`, for a tenant running its own bot

## Design decisions

**Telegram's theme is applied at runtime.** `telegram.ts` copies Telegram's
`themeParams` onto our CSS variables before React paints, so the app matches
the user's Telegram appearance on the first frame instead of flashing.

**Tokens are kept in memory only.** A Mini App session lasts as long as the
sheet is open, and one device may host several Telegram accounts — persisting
a token to `localStorage` risks handing one Telegram user another's session.

**Haptics on add-to-cart and on the order result**, which is what makes a Mini
App feel native rather than like a web page in a frame.

## Deployment

Served at `<domain>/tg/`. Note that the storefront host deliberately does
**not** send `X-Frame-Options: DENY` — Telegram renders the Mini App inside a
frame.

Register the production URL with BotFather once deployed.

## Not yet built

Telegram's native `MainButton` for checkout (the helper exists in
`telegram.ts`), saved addresses, order tracking and payment via Telegram.
