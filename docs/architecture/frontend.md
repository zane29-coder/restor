# Client apps

Six apps, one API client. None of them talks to the API directly — everything
goes through `@restor/api-client`, so auth, token refresh, the response
envelope and error normalisation exist once.

| App | Who uses it | Stack | Served at |
| --- | --- | --- | --- |
| `admin-web` | Restaurant staff, and platform staff | React 18 + Vite | `/admin` |
| `pos` | Cashier | React 18 + Vite | `/pos` |
| `kitchen-display` | Kitchen | React 18 + Vite | `/kds` |
| `customer-web` | Customers | React 18 + Vite | `/` |
| `telegram-mini-app` | Customers in Telegram | React 18 + Vite | `/tg` |
| `courier-mobile` | Couriers | React Native, Expo 51 | APK |

Each Vite app is built with a matching `--base` or its asset URLs resolve
against the domain root and 404.

## Rules that apply to all of them

**`npm run build:packages` before anything.** A confusing type error in an app
is almost always a stale `packages/*/dist`.

**Never call `fetch` directly.** Add a method to the relevant resource in
`packages/api-client/src/resources/`.

**Lists use `getPaginated`.** See `KNOWN_ISSUES.md` — `get<Paginated<T>>`
returns a bare array and every list silently renders empty.

**Icons are inline SVG from `@restor/ui`, never emoji.** Emoji render
differently on every OS and read as decoration rather than interface. Telegram
*messages* are the deliberate exception — there, emoji are field markers.

**Uzbek in the UI.** Including error text.

## admin-web

Two layouts behind one login, chosen by who signed in.

`AppLayout` — the restaurant's own staff. Twelve pages: Dashboard, Buyurtmalar,
Menyu, Filiallar, Xodimlar, Kuryerlar, Mijozlar, Aksiyalar, Stollar, Ombor,
Hisobotlar, Telegram. The sidebar is permission-filtered, so a cashier sees a
short list and an owner sees all of it. **A missing page is almost always a
missing permission, not a missing build** — check the token before the bundle.

`PlatformLayout` — `SUPER_ADMIN`. A separate surface with its own nav
(Platforma, Korxonalar, Planlar), because a platform admin's token carries no
tenant and every tenant-scoped page would be dead.

State is TanStack Query. Boards that a person watches — the dispatcher, the
waiter-call queue — set `refetchInterval`; nothing else polls.

## pos

Gated behind an open cash shift: selling outside one puts money in a drawer
nobody is accountable for. Flow is open shift → sell → tender → receipt →
close against a count.

Keeps selling offline. Orders queue in `localStorage` stamped with a
`clientUuid` generated *before* the first attempt, and the queue carries the
tender alongside the order — replaying an order without its payment would
leave a cash sale unpaid and the drawer refusing to balance. Replay is safe
because the backend is idempotent on `clientUuid`.

Printing is `window.print()` against a print stylesheet. A thermal printer on
that counter is reached through the OS print queue like any other.

## kitchen-display

Read-mostly ticket board, polled. Touch targets are large because it is used
with wet hands at arm's length.

## customer-web and telegram-mini-app

Public storefront. Menu, cart, checkout. The Mini App additionally
authenticates with Telegram `initData`, verified by HMAC server-side — see
`../integrations/telegram.md`.

Both reach public routes where there is no JWT, so the tenant is resolved from
the slug or Host by `TenantResolverMiddleware`.

## courier-mobile

React Native + Expo SDK 51, shipped as an APK. Not in the npm workspace: Expo
resolves its own native modules and npm's hoisting breaks that, so it keeps its
own `node_modules` and pulls shared packages in through `file:` links pointing
at their `dist/`.

Expo Go no longer opens it — Expo Go tracks only recent SDKs. Build the APK:
`apps/courier-mobile/README.md`.

Three tabs: Buyurtma, Kassa, Profil. Tokens live in SecureStore rather than
AsyncStorage — a courier's phone is the device most likely to be lost, and its
token can move cash. Location is reported only while the courier is on shift
and only after they grant permission.
