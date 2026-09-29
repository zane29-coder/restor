# POS terminal

The till (TZ §17-§20). React 18 + Vite, built for a touchscreen.

## Development

```bash
npm install && npm run build:packages    # from the repository root
npm run dev:pos                          # http://localhost:5175
```

Sign in with the seeded cashier — `+998904444444` / `Restor2026dev`,
restaurant `demo` — then pick a branch. Both are remembered per device.

## Build

```bash
npm run build --workspace=@restor/pos
```

## Design decisions

**Not a shrunken admin panel** (TZ §17). Every target is at least 56px, the
layout is a fixed two-column menu/cart so nothing reflows mid-service, and the
totals are large enough to read while handing over change.

**The connection state is always visible.** A cashier has to know instantly
whether a sale reached the server, so the header carries a green/red chip and
a count of queued orders.

**The local total is an estimate.** The authoritative amount comes back from
the server, which re-prices the whole cart (TZ §76).

## Offline mode (TZ §18)

When the network drops the till keeps selling:

1. Each order is stamped with a `clientUuid` **before** the first attempt.
2. On a network failure it goes to a local queue and the cashier continues.
3. On reconnect — and every 30 seconds while anything is queued — the queue
   replays oldest-first.
4. Replay is safe because order creation is idempotent on `clientUuid`: the
   backend returns the original order rather than creating a second one.

The queue stops at the first network failure; if the link is still down there
is no point burning through the rest. A **server** rejection (a stop-listed
product) is permanent, so that entry is dropped and surfaced to the cashier
rather than retried forever.

`src/offline-queue.ts` uses `localStorage` and is self-contained, so a desktop
shell can swap in SQLite without the rest of the app changing.

## Desktop shell

The browser build covers a tablet or a mini-PC with a browser. For a dedicated
terminal with receipt-printer access, wrap it in **Tauri** (a few MB) or
**Electron** (heavier, more mature tooling) in `apps/pos/desktop/`.

Do **not** wrap the admin panel into an `.exe` instead (TZ §50): the POS has
its own lifecycle and offline requirements, which is why it is a separate app.

## Deployment

Served by nginx at `admin.<domain>/pos/`, in kiosk mode:

```bash
chromium --kiosk --app=https://admin.restor.uz/pos/
```

## Not yet built

Cash shifts (open/close, expected vs actual), receipt printing via ESC/POS,
mixed payments, refunds and table selection. The API contracts and database
schema for all of these exist; the screens are the remaining Phase 6 work.
