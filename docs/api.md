# API

Base URL: `/api/v1` (TZ §42). Interactive docs at `/api/docs` in development.

---

## Response envelope

Every endpoint returns the same shape (TZ §43). Handlers return plain data; a
single interceptor wraps it and a single filter wraps every error, so the shape
cannot drift between endpoints.

**Success**

```json
{
  "success": true,
  "data": { },
  "error": null,
  "meta": { "requestId": "…", "timestamp": "2026-09-29T01:20:00.000Z" }
}
```

**List** — `data` is the array, paging moves to `meta`:

```json
{
  "success": true,
  "data": [ ],
  "error": null,
  "meta": {
    "requestId": "…",
    "pagination": { "page": 1, "limit": 20, "total": 143,
                    "totalPages": 8, "hasNext": true, "hasPrev": false }
  }
}
```

**Error**

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "ORDER_NOT_FOUND",
    "message": "Order not found",
    "details": { "phone": ["Invalid phone number"] }
  },
  "meta": { "requestId": "…" }
}
```

Branch on `error.code`, never on the message or the HTTP status — the status
cannot distinguish `ORDER_NOT_FOUND` from `PRODUCT_NOT_FOUND`. The full list is
in [`packages/shared-types/src/error-codes.ts`](../packages/shared-types/src/error-codes.ts).

`details` carries per-field messages, keyed by dotted path, ready to render
next to a form input.

Payment webhooks opt out with `@RawResponse()`: the provider dictates that
format.

---

## Status codes

| Code | Meaning |
| --- | --- |
| 200 / 201 | Success |
| 204 | Success, no body |
| 400 | Malformed request |
| 401 | Missing, invalid or expired token |
| 402 | Subscription expired or a plan limit reached |
| 403 | Authenticated but not permitted |
| 404 | Not found — **or hidden by tenant scoping** |
| 409 | Conflict: duplicate, or an illegal state transition |
| 422 | Validation failed, or a business rule rejected it |
| 423 | Account temporarily locked |
| 429 | Rate limited |

A cross-tenant read returns **404, not 403**: confirming that a record exists
elsewhere is itself a leak.

---

## Authentication

```http
Authorization: Bearer <accessToken>
```

Access tokens last 15 minutes. `@restor/api-client` refreshes them
automatically — including collapsing concurrent 401s into a single refresh, so
a rotation cannot invalidate the token the other requests are still using.

See [authentication.md](authentication.md).

---

## Headers

| Header | Direction | Purpose |
| --- | --- | --- |
| `Authorization` | → | Bearer token |
| `X-Tenant-Slug` | → | Which restaurant, for **public** storefront routes |
| `Idempotency-Key` | → | Sent automatically with an order's `clientUuid` |
| `X-Request-Id` | ⇄ | Correlates the response with its log line; generated if absent |

`X-Tenant-Slug` carries a public slug, not an id: the backend looks the tenant
up itself and a real token always overrides it.

---

## Endpoints

### Auth
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/login` | Public. 10 req/min |
| POST | `/auth/telegram` | Public. Verifies `initData` server-side |
| POST | `/auth/refresh` | Public. Rotates the pair |
| POST | `/auth/logout` | Revokes the session |
| GET | `/auth/me` | Identity + flattened permissions |
| POST | `/auth/change-password` | Ends every other session |

### Platform — `@SuperAdminOnly`
`GET /platform/stats` · `GET|POST /platform/tenants` ·
`PATCH /platform/tenants/:id` · `POST /platform/tenants/:id/block|activate` ·
`GET /platform/tenants/:id/usage` · `POST /platform/tenants/:id/subscription` ·
`GET|POST /platform/plans`

### Branches
`GET /branches` · `GET /branches/summary` *(public picker)* ·
`GET|PATCH|DELETE /branches/:id` · `POST /branches`

### Staff & RBAC
`GET|POST /employees` · `GET|PATCH /employees/:id` ·
`POST /employees/:id/deactivate` · `POST /employees/:id/reset-password` ·
`POST /users/:id/roles` · `GET|POST /roles` · `GET|PATCH|DELETE /roles/:id` ·
`GET /permissions`

### Menu
`GET|POST /categories` · `PATCH|DELETE /categories/:id` ·
`POST /categories/reorder` · `GET|POST /products` ·
`GET|PATCH|DELETE /products/:id` · `PATCH /products/:id/availability` ·
`GET|POST /modifier-groups` · `PATCH|DELETE /modifier-groups/:id` ·
`GET /menu/:branchId` *(public)* · `POST /files/images`

### Orders
`GET /orders` · `GET /orders/:id` · `GET /orders/:id/timeline` ·
`POST /orders/preview` *(public)* · `POST /orders` *(public)* ·
`PATCH /orders/:id/status`

### Kitchen
`GET /kitchen/tickets?branchId=` · `POST /kitchen/tickets/:id/start|ready`

### Audit & health
`GET /audit` · `GET /health` · `GET /health/ready`

---

## Conventions

**Pricing is server-side.** `POST /orders` accepts product ids, quantities and
modifier ids — never prices. `POST /orders/preview` returns the exact totals
the customer will be charged, from the same code path that prices the real
order (TZ §76).

**Order creation is idempotent** on `clientUuid`. Replaying it returns the
original order, which is what makes the POS offline queue safe (TZ §18).

**Money is an integer in minor units.** `156000` is 156 000 UZS.

**Pagination** uses `?page=1&limit=20`, capped at 100 server-side — an
unbounded limit on an orders table is a denial-of-service vector.

**Soft deletes.** Branches, products, categories and staff are deactivated,
not removed, so a six-month-old order still renders correctly.

---

## Rate limits

| Scope | Limit |
| --- | --- |
| Global | 120 req/min per IP |
| `/auth/login` | 10 req/min |
| `/auth/telegram` | 20 req/min |
| `/auth/refresh` | 30 req/min |

nginx applies a second, coarser layer in production. Payment webhooks are
exempt — the provider retries on failure, and a dropped callback leaves an
order unpaid.

---

## Realtime

Socket.IO at `/realtime`. Authenticate in the handshake:

```ts
io('/realtime', { auth: { token: accessToken } });
socket.emit('subscribe', { rooms: [`branch:${branchId}`] });
```

Rooms: `branch:<id>` · `kitchen:<id>` · `pos:<id>` · `order:<id>` ·
`courier:<id>` · `dispatch:<tenantId>`.

The socket's tenant comes from its token, and `subscribe` refuses any room
outside it — otherwise a client could simply ask to join another restaurant's
branch and watch its orders arrive.

Events: `order:created` · `order:updated` · `order:status` ·
`kitchen:ticket_created` · `kitchen:ticket_updated` · `courier:location` ·
`courier:job_assigned` · `waiter:call` · `menu:stop_list_changed`.
