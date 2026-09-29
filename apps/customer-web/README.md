# Customer storefront

Where a customer orders from a browser (TZ §11, §47). React 18 + Vite,
mobile-first.

## Development

```bash
npm install && npm run build:packages    # from the repository root
npm run dev:customer                     # http://localhost:5174?tenant=demo
```

No sign-in: a guest orders with a phone number.

## Build

```bash
npm run build --workspace=@restor/customer-web
```

## Which restaurant is this?

Resolved in `src/api.ts`, most explicit first:

| Form | Example | Used by |
| --- | --- | --- |
| Path | `restor.uz/r/demo` | The default multi-tenant URL |
| Host | `order.demo.uz` | A tenant's white-label domain (TZ §49) |
| Query | `?tenant=demo` | Local development |

The slug is sent as `X-Tenant-Slug`. The backend looks the id up itself — the
client never supplies a tenant id (TZ §52).

## Flow

```
branch → menu → cart → pickup/delivery → details → confirmation
```

Matches TZ §11. With a single branch the picker is skipped entirely.

## Design decisions

**Mobile-first.** Most orders arrive from a phone, so the cart is a bottom
sheet rather than a sidebar, inputs are 16px (below that iOS Safari zooms on
focus), and the layout respects `env(safe-area-inset-bottom)`.

**Totals come from the server.** The cart shows a local estimate for
responsiveness, but the number the customer confirms is fetched from
`/orders/preview` — the same code path that prices the real order. What is
shown and what is charged cannot diverge.

**`clientUuid` is generated before submitting**, so a double tap or a retry on
a flaky connection cannot create two orders.

**The palette is CSS custom properties**, so a tenant's `primaryColor` can be
applied at runtime for white labelling.

## Deployment

Static files served by nginx at the root domain, with an SPA fallback so
`/r/{slug}` reaches the app.

## Not yet built

Saved addresses, order tracking with live status, order history, loyalty
points and a map-based address picker. The API supports the first four; they
are the remaining Phase 10 work.
