# Kitchen Display System

The kitchen's ticket board (TZ §21, §22). React 18 + Vite, built for a
wall-mounted touchscreen.

## Development

```bash
npm install && npm run build:packages    # from the repository root
npm run dev:kds                          # http://localhost:5176
```

Sign in with the seeded kitchen account — `+998905555555` / `Restor2026dev`,
restaurant `demo` — then pick a branch. Both are remembered per device, so the
screen survives a reboot without anyone touching it.

## Build

```bash
npm run build --workspace=@restor/kitchen-display
```

## Design decisions

**Dark, large, gloved-hand.** Read from two metres away by someone whose hands
are full: dark background to cut glare, 30px order numbers, and buttons at
64px — well above the 44px accessibility floor.

**Polling, not WebSocket.** A kitchen screen runs unattended for weeks. A poll
that misses a beat recovers by itself; a dropped socket needs reconnection
logic nobody is watching. Three seconds is well inside the time it takes to
read a new ticket.

**A connection blip does not blank the board.** Stale tickets stay on screen
with a warning banner — an empty kitchen display is far more dangerous than a
slightly old one.

**The timer is computed locally** from `createdAt` rather than from the
server's `elapsedSeconds` snapshot, so it ticks smoothly instead of jumping
every three seconds.

**Colour is never the only signal.** The urgency band (green < 10 min, amber
< 20, red beyond) is accompanied by the elapsed time in text, which is what
makes it readable with red-green colour blindness.

## Station routing

When the branch has kitchen stations configured, an order is split into one
ticket per station, so the grill screen shows only grill items. With no
stations, the whole order is one ticket — which is what a small kitchen wants.

The first station to press START moves the order to `PREPARING`; the order
reaches `READY` only once every station is done.

## Deployment

Served by nginx at `admin.<domain>/kds/`. On a dedicated tablet, open it in
kiosk mode:

```bash
chromium --kiosk --app=https://admin.restor.uz/kds/
```

Disable the device's screen timeout and auto-updates — a kitchen screen that
reboots mid-service is worse than no screen.
