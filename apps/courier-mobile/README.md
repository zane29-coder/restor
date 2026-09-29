# Courier app

The courier's phone app (TZ §23-§26). React Native + Expo, built as an APK.

## Why this is not an npm workspace

Expo resolves its own native modules, and npm's hoisting breaks that linking.
The app installs independently and `metro.config.js` tells Metro where the
shared packages are.

## Install

```bash
# From the repository root, once:
npm install && npm run build:packages

# Then:
cd apps/courier-mobile
npm install
```

## Development

```bash
npx expo start
```

Press `a` for an Android emulator, or scan the QR code with Expo Go.

`src/api.ts` defaults to `http://10.0.2.2:3000/api/v1` — the Android
emulator's alias for the host machine. On a physical device, set your LAN IP
in `app.json` under `expo.extra.apiUrl`.

Sign in with the seeded courier: `+998906666666` / `Restor2026dev`,
restaurant `demo`.

## Building the APK

```bash
npm install -g eas-cli
eas login
eas build:configure

npm run build:apk    # APK, for direct distribution
npm run build:aab    # AAB, for Google Play
```

Set the production API URL in `app.json` (`expo.extra.apiUrl`) before
building.

## Screens

**Job list** — the courier's own deliveries, polled every 20 seconds, with
pull-to-refresh. Each card shows the pickup branch, the customer address, the
items and — prominently — whether cash is to be collected and how much.

**Actions** — ACCEPT → ON MY WAY → DELIVERED, plus one-tap call and a map
handoff (`geo:` opens whichever maps app the courier has installed).

**Status toggle** — online/offline. Going offline stops location reporting.

## Design decisions

**Tokens live in SecureStore**, not `AsyncStorage`. A courier's phone is the
most likely device to be lost or stolen, and its token can move money — cash
collected on delivery. `AsyncStorage` is plain text on a rooted device.

**Location is reported only while online** and only after the courier grants
permission (TZ §25). Tracking someone who is off shift is neither needed nor
acceptable. Pings are throttled to 20 seconds or 50 metres, and a dropped ping
is swallowed rather than interrupting the courier.

**Every endpoint is scoped server-side.** The app never sends its own courier
id, so it cannot read another courier's jobs even if the client were tampered
with.

**56px minimum targets.** These are tapped one-handed, outdoors, often in the
cold.

**A 30-second timeout**, longer than the web default: on patchy mobile data a
false failure makes a courier re-tap "delivered", which is worse than waiting.

## Not yet built

Background location (the app currently reports only in the foreground), push
notifications for new assignments, the cash-handover flow (TZ §28), and a
wallet transaction history. The API contracts for all of these are defined in
`@restor/shared-types`.
