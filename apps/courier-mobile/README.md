# Courier app

The courier's phone app (TZ §23-§26). React Native + Expo, built as an APK.

## Why this is not an npm workspace

Expo resolves its own native modules, and npm's hoisting breaks that linking.
So this app keeps its own complete `node_modules` and pulls the shared
packages in with `file:` links rather than workspace ranges — a `*` range
would send npm looking for `@restor/shared-types` on the public registry.

Those links resolve to each package's **`dist/`**, the same compiled output
the web apps consume. After editing a shared package, rebuild it or the app
will not see the change.

## Install

```bash
# From the repository root, once — the file: links point at dist/
npm install && npm run build:packages

# Then:
cd apps/courier-mobile
npm install
```

## Development

```bash
npx expo start
```

Scan the QR code with **Expo Go** ([Android](https://play.google.com/store/apps/details?id=host.exp.exponent)
· [iOS](https://apps.apple.com/app/expo-go/id982107779)). The phone must be on
the same Wi-Fi as this machine; `npx expo start --tunnel` works across networks
if it is not.

> Current Expo Go builds support only the newest SDKs and refuse this app
> (SDK 51) with "only supports SDK NN". For a phone, build the APK — see
> [Building the APK](#building-the-apk). Expo Go still works from an older
> build, and the Android emulator is unaffected.

Point the app at a backend in `app.json` → `expo.extra.apiUrl`:

| Target | Value |
| --- | --- |
| Deployed | `https://restore-1.duckdns.org/api/v1` |
| Local, physical phone | `http://<your-LAN-IP>:3000/api/v1` |
| Local, Android emulator | `http://10.0.2.2:3000/api/v1` |

`localhost` never works from a phone — it resolves to the phone itself.

Sign in with the seeded courier: `+998906666666` / `Restor2026dev`,
restaurant `demo`.

### Verifying it bundles without a device

```bash
npx expo export --platform android --output-dir .expo-export
```

Proves Metro resolves everything, including the linked packages. Faster than
waiting for a phone to fail.

## Building the APK

Couriers install a real APK. Expo Go is a development tool — it tracks only
recent SDKs, so it stops opening this app the moment it falls behind, and
asking a courier to install a second app to run the first one is not a
deployment.

The build runs on the Linux build host (`75.119.148.246`), which carries JDK 17
and Android SDK 34:

```bash
# Upload the app and the compiled shared packages:
tar -czf courier-src.tgz --exclude=node_modules --exclude=.expo \
  apps/courier-mobile \
  packages/{shared-types,shared-utils,api-client}/{dist,package.json}
scp courier-src.tgz root@75.119.148.246:/tmp/
ssh root@75.119.148.246 'tar -xzf /tmp/courier-src.tgz -C /opt/restor-build'

# Then:
ssh root@75.119.148.246 '/opt/restor-build/build-courier-apk.sh build'
```

The script lives at [`infrastructure/deployment/build-courier-apk.sh`](../../infrastructure/deployment/build-courier-apk.sh);
`setup` installs the toolchain and only needs running once.

Set `expo.extra.apiUrl` in `app.json` **before** building — it is baked into
the binary and cannot be changed afterwards without a rebuild.

### The keystore

`/opt/restor-build/restor-courier.keystore` signs every release, and a copy is
in `release/` locally (gitignored — a signing key does not belong in a repo).

**Back it up somewhere off both machines.** It cannot be regenerated: an update
signed with a different key installs as a different app, and every courier
would have to uninstall and reinstall, losing their session. Google Play will
not accept a key change at all.

### EAS as an alternative

`eas build --platform android --profile preview` builds the same APK in the
cloud and needs a free Expo account — useful if the build host is unavailable,
but it uses its own managed keystore unless you upload this one.

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
