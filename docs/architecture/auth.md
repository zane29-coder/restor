# Authentication

---

## Tokens

| | Access | Refresh |
| --- | --- | --- |
| Lifetime | 15 minutes | 30 days |
| State | Stateless | Stored, hashed |
| Contains | userId, tenantId, roles, permissions, branchIds | userId, jti |
| Secret | `JWT_ACCESS_SECRET` | `JWT_REFRESH_SECRET` — **must differ** |

The two secrets must differ, and the API refuses to start if they match:
sharing one would make a stolen refresh token a valid access token, defeating
the point of having two.

Permissions are baked into the access token, so authorising a request costs no
database round trip. The trade-off is that a permission change takes effect at
the next refresh — which is why the access TTL is short and why every path that
changes a user's access revokes their refresh tokens immediately.

Refresh tokens are stored as SHA-256 hashes. A database dump therefore does not
hand out live sessions.

---

## Sign-in

`POST /auth/login` with a phone or an email plus a password.

The lookup runs unscoped — the tenant is not known until the user is found.
Without `tenantSlug` it must be unambiguous: the same phone may legitimately
belong to staff at two restaurants, and guessing would silently sign someone
into the wrong company. The API says so explicitly rather than picking one.

Failure paths are deliberately uniform: an unknown login burns the same CPU
time as a wrong password (via a pre-computed dummy hash) and returns the same
message, so response timing cannot be used to enumerate registered numbers.

After 10 failed attempts the account locks for 15 minutes (`423`).

---

## Passwords

Argon2id with the OWASP minimum — 19 MiB memory, `t=2`, `p=1`. Roughly 40 ms
per login: fast enough for a POS sign-in, slow enough that a stolen database is
expensive to crack. Memory-hardness is the point — bcrypt falls to GPUs in a
way Argon2id does not.

Policy: 10+ characters with a letter and a digit. Length-first rather than a
symbol-class maze, which in practice produces stronger passwords that are less
likely to end up on a sticky note next to the till.

---

## Refresh rotation

Each refresh issues a new pair and marks the old token `revokedAt` with
`replacedByTokenHash`.

If a token that was *already rotated* is presented again, the only two
explanations are a stolen token or a cloned device — so **every session for
that user is revoked**, not just that one.

The permission set is rebuilt from the database on each refresh rather than
copied from the old token, so a role change propagates at the next refresh
without waiting for a re-login.

On the client, `@restor/api-client` collapses concurrent 401s into a single
in-flight refresh. Without that, the first rotation would invalidate the token
the other three requests were still trying to use, and the user would be
logged out mid-action.

---

## Telegram Mini App

`POST /auth/telegram` with the raw `initData` string, forwarded verbatim.

This is the entire security boundary for Mini App sign-in: everything inside
`initData` — including the Telegram user id — is attacker-controlled until the
HMAC check passes. **No field is read before verification succeeds.**

```
secret = HMAC_SHA256(key: "WebAppData", message: bot_token)
check  = HMAC_SHA256(key: secret, message: data_check_string)
```

where `data_check_string` is every field except `hash`, sorted by key and
joined with newlines.

Three further checks, because a valid signature alone is replayable forever:

- `auth_date` must be within `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` (24 h).
- A timestamp meaningfully in the future is rejected.
- The comparison is constant-time.

Rejections are logged with the specific reason and returned without it —
telling a caller which check failed helps them craft the next attempt.

Mini App users are **customers**, not staff: they receive a customer record and
a token with no staff permissions at all.

---

## Public routes and tenant resolution

The storefront has no staff token, but its queries must still be tenant-scoped
or the Prisma extension refuses them.

`TenantResolverMiddleware` resolves the tenant, most explicit first:

1. `X-Tenant-Slug` — what the storefront SPA sends
2. `Host` matching a tenant's white-label `domain`
3. The leading label of the host (`demo.restor.uz` → `demo`)

It only ever *sets* a tenant when the context has none, and it runs before the
auth guard — so a real token always wins and a client cannot widen its scope by
adding a header. The client supplies a public slug; the id is looked up
server-side.

A blocked or suspended tenant resolves to nothing, so its storefront stops
serving immediately rather than degrading.

---

## Sessions across clients

| Client | Token storage | Why |
| --- | --- | --- |
| Admin web | `localStorage` | Survives a reload; the device is a staff workstation |
| POS / KDS | `localStorage` | Signed in once at install, then left running |
| Customer web | `localStorage` | Convenience for a returning customer |
| Mini App | **Memory only** | A Telegram session lasts as long as the sheet, and one device may host several Telegram accounts |
| Courier app | **SecureStore** | The most likely device to be lost or stolen, and its token can move cash |

---

## Sessions are revoked when

- The user changes their own password
- An admin resets their password
- Their roles or branch scope change
- They are deactivated
- Their tenant is blocked
- A rotated refresh token is replayed

Revocation is what makes "block this tenant" mean something: without it, staff
holding a valid access token would keep working for up to its full TTL.

---

## Configuration

```ini
JWT_ACCESS_SECRET=<48+ random bytes, base64url>
JWT_REFRESH_SECRET=<different 48+ random bytes>
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d
AUTH_MAX_FAILED_ATTEMPTS=10
AUTH_LOCKOUT_MINUTES=15
ENCRYPTION_KEY=<exactly 32 bytes, base64>
TELEGRAM_BOT_TOKEN=<platform bot>
TELEGRAM_INIT_DATA_MAX_AGE_SECONDS=86400
```

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"  # JWT
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"     # encryption
```

`ENCRYPTION_KEY` protects secrets stored in the database — tenant bot tokens
and payment-provider keys — with AES-256-GCM. Authenticated encryption, so a
tampered ciphertext fails to decrypt rather than silently yielding garbage.
Production refuses to start without it.
