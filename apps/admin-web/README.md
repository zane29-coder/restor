# Admin web

The restaurant's control panel (TZ §46): every screen a restaurant runs on,
plus the separate super-admin surface under the same origin. React 18 + Vite +
TanStack Query, Leaflet for maps, charts drawn as plain SVG.

## Requirements

Node ≥ 20, and the API running on `:3000`.

## Install

```bash
npm install                  # from the repository root
npm run build:packages
```

## Development

```bash
npm run dev:admin            # http://localhost:5173
```

Vite proxies `/api` to `localhost:3000`, so the browser sees a same-origin API
and there is no CORS round trip.

Sign in with a seeded account — `+998901111111` / `Restor2026dev`, restaurant
`demo`.

## Environment

```bash
cp .env.example .env
```

| Variable | Default | Notes |
| --- | --- | --- |
| `VITE_API_URL` | `/api/v1` | Relative on purpose: nginx serves the app and proxies `/api` to the backend in production |
| `VITE_POS_URL` | derived | Where "Yangi buyurtma" and "POSda ochish" go. Unset: `app.x` → `pos.x`, `localhost` → `:5175` |

## Build

```bash
npm run build                # → dist/
npm run preview
```

Deployed as static files on its own host, `app.<domain>` — in production
`https://app.restor.uz`. `infrastructure/deployment/deploy.sh` (or
`deploy-shared-host.sh`) publishes `dist/` to the nginx web root.

The bundle is built with `--base=/` and does not know its domain: `/api/v1` is
proxied by whichever host serves it, which is what keeps `VITE_API_URL`
relative and every request same-origin.

## Screens

| Route | Contents | Permission |
| --- | --- | --- |
| `/login` | Sign-in | — |
| `/` | KPIs against the previous period, sales chart, sources, branch targets, active orders, low stock | — |
| `/orders` | Table and kanban, counts per status, filters, side panel with timeline, print | `orders.view` |
| `/menu` | Catalogue, per-branch availability and stop-list, import/export, duplicate | `products.view` |
| `/branches` | Branches, hours, daily target, auto-dispatch, polygon delivery zones on a map | `branches.view` |
| `/employees` | Staff, roles and a permission matrix | `employees.view` |
| `/couriers` | Live map, dispatch board, auto-dispatch, wallets | `couriers.view` |
| `/customers` | CRM segments, notes, loyalty | `customers.view` |
| `/marketing` | Promotions, promo codes, happy hours, results per offer | `promotions.view` |
| `/tables` | Live floor plan and editor, QR codes, waiter calls, reservations | `tables.view` |
| `/inventory` | Stock, batches and use-by dates, supplier orders via Telegram, stock-takes | `inventory.view` |
| `/reports` | Sales, product margins and ABC, cash and Z-reports, branch comparison | `reports.view` |
| `/telegram` | Bot status, groups and events, Mini App appearance and checkout rules | `telegram.view` |

The shell: grouped sidebar with live badges, branch switcher (a filter, never
an authorisation), Ctrl+K command palette, notifications, light/dark theme.

## Notes

- **Permission checks are presentation only.** `can()` and `<Can>` hide UI the
  user cannot act on; the backend enforces the same permission on every call.
  A hidden button is a courtesy, never a control.
- **Status buttons come from the shared state machine.** `ORDER_STATUS_TRANSITIONS`
  is the same table the backend validates against, so the UI cannot offer a
  move the API will reject.
- **Styling is plain CSS with custom properties**, not a utility framework:
  the palette has to be overridable at runtime for white labelling (TZ §49),
  which a build-time config cannot do.

## Not yet built

The product variant editor (the API supports it) and stock transfers between
branches (movement types exist, no pairing UI).
