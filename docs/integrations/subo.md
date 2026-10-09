# Subo — online payment

Docs: `docs.subo.uz`. Client: `backend/src/integrations/subo/subo-api.client.ts`.
Service: `backend/src/modules/payments/subo.service.ts`.

Subo aggregates **Atmos, Click and Payme** behind one hosted checkout, and
saves the customer's card for next time. It replaces what would otherwise be
three separate provider integrations.

## Current state

The merchant key is stored and the callback URL is verified reachable.
**Checkout cannot complete**: Subo returns *"Hech qanday to'lov provayderi
sozlanmagan"* — the restaurant has not connected Atmos, Click or Payme to
their Subo account. Nothing to change on our side.

## Three properties that shape the code

### Callbacks are unsigned

Subo's own documentation says to treat a webhook as a signal and read the real
status back from `GET /orders/:id`.

So `handleCallback` uses the request body for exactly one thing — **which
payment to ask about** — and acts on Subo's answer. A forged callback achieves
nothing beyond one wasted API call. The smoke test asserts this with a
fabricated `order.paid` carrying a huge amount.

The webhook route is `@Public()`. That is safe only because of the above.

### Amounts are in tiyin

1 soʻm = 100 tiyin. RESTOR stores whole soʻm. The ×100 crossing lives in
`SuboApiClient.toTiyin` / `fromTiyin` and nowhere else — getting it wrong
charges a customer 100× or 1/100× the bill.

Subo accepts 1 000–500 000 000 tiyin (10 – 5 000 000 soʻm), checked before the
HTTP call so a bad amount fails locally.

Responses return `amountTiyin` as a **string**; the client coerces.

### Cards are saved against a customer id

Passing our `Customer.id` as `customerId` makes **Atmos** store the card on
their side; the next checkout for that customer offers it at one tap. We never
see or store a card number — that is the entire point of using them.

Only Atmos. Naming `provider: 'ATMOS'` forces that path; omitting `provider`
lets the customer choose on Subo's page.

## Configuration

Per tenant, not per platform: each restaurant has its own merchant account and
money must land with whoever sold the food.

```
GET  /payments/subo/config    state only — the key is never returned
POST /payments/subo/config    apiKey?, isActive?
```

Stored in `payment_provider_configs`, AES-256-GCM encrypted at rest, in a
table listed in `STRICT_TENANT_MODELS`. Write-only through the API: Subo shows
a merchant key once at creation, so a leak from here would be unrecoverable.
`req.body.apiKey` is in the pino redaction list.

Sandbox is derived from the key's own prefix (`sk_test_`) rather than asked
for separately — one fewer way to point a production restaurant at the
sandbox.

## Checkout

```
POST /payments/subo/checkout    orderId, provider?, returnUrl?
GET  /payments/subo/order/:orderId
```

Creates a `Payment` row with `method: SUBO`, `status: PENDING`, the Subo order
id in `externalId`, and the hosted URL in `checkoutUrl`.

**A live session is resumed, not duplicated.** A customer who closed the tab
is sent back to the same Subo session; two live checkouts for one order is how
someone gets charged twice. Subo expires a checkout after 30 minutes, after
which a new one is created.

`externalReference` is `${orderId}:${outstanding}`, which Subo treats as
idempotent — a double-tap on "pay" returns the same Subo order.

## The callback URL

```
https://<host>/api/v1/webhooks/subo
```

Built with `apiUrl()`. It was once advertised without `/api/v1`, which is the
static site: every callback would have returned 405, Subo would have retried
five times and given up, and the charge would sit PENDING with the customer
already charged. See `../context/KNOWN_ISSUES.md`.

Paste this into Subo's dashboard. `GET /payments/subo/config` returns the
correct one.

## Settling

`reconcile()` is safe to call repeatedly — crediting is guarded by the
payment's own status, and the status is re-read **inside** the transaction so
two concurrent callbacks cannot both pass the check.

The amount credited is **Subo's**, not our expectation: crediting what we
asked for would let a partial capture look like a full one.

A successful payment also writes a `SALE` into the branch's open shift if
there is one — which reaches `onlineTotal` but not `expectedCash`, because
online money never enters a drawer.

`PaymentTransaction.idempotencyKey` is `subo:<orderId>:<status>` and unique, so
a replayed event collides there instead of duplicating.

## Testing

Ask Subo for an `sk_test_` key. The flow is identical and no real money moves;
the checkout page shows "payment successful" and "payment error" buttons, and
webhooks carry `"sandbox": true`.
