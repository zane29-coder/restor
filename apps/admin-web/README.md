# Admin web

The restaurant's control panel (TZ §46): dashboard, orders, menu, branches and
staff. React 18 + Vite + TanStack Query.

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

## Build

```bash
npm run build                # → dist/
npm run preview
```

Deployed as static files; `infrastructure/deployment/deploy.sh` publishes
`dist/` to the nginx web root.

## Screens

| Route | Contents | Permission |
| --- | --- | --- |
| `/login` | Sign-in | — |
| `/` | Today's revenue, orders, average check, source split, active orders | — |
| `/orders` | List, filters, status actions, detail with timeline | `orders.view` |
| `/menu` | Products, create, per-branch stop-list | `products.view` |
| `/branches` | Branch cards with hours and delivery settings | `branches.view` |
| `/employees` | Staff, roles, branch scope | `employees.view` |

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

Variant and modifier editors, promotions, promo codes, customers, finance,
Telegram settings and reports. The API supports them; these screens are the
remaining work for phases 9–10.
