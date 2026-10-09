# Known issues

Things already found. Check here before investigating something odd — and add
to it when you find something you are not fixing now.

---

## Open

### The admin UI has never been clicked through
Every API behind every screen is covered by tests. The screens themselves were
typechecked, built and deployed, and that is all. Rendering bugs, broken
buttons and bad layouts would not have been caught.

### Browser cache can pin an old admin bundle
Bundles are served `immutable, max-age=1 year` with a content hash in the
filename, and `index.html` with `max-age=0, must-revalidate`. That is correct —
but a browser that cached `index.html` long-term before the policy was fixed
will serve the old HTML *and* its old bundle entirely from cache and never ask
the server.

Symptom: the sidebar is missing pages that exist in the deployed bundle.
Fix: Ctrl+Shift+R. Confirm the server is fine by grepping the deployed bundle
for the missing page name before suspecting the code.

### `tenantId` appears twice in some log lines
Cosmetic. Both values are identical. Pino's `customProps` and the request
context both stamp it.

### Seven tenants in production, one is real
`demo` is real. The rest are `isolation-test-*`, `courier-isolation-*` and
`osh-markazi-*`, left behind by isolation smoke tests. There is no
delete-tenant endpoint — only block — so cleaning them means SQL against the
server.

### Running the whole smoke suite back-to-back trips the rate limiter
Nine scripts in a row returns `RATE_LIMITED`. The limiter is working; the
scripts are just faster than a human. Run them individually with ~60s between,
or raise the limit temporarily.

### Subo cannot complete a checkout
Not our bug. The merchant account has no payment provider connected, so Subo
returns *"Hech qanday to'lov provayderi sozlanmagan"*. Our side is configured
and the callback URL is verified. See `docs/integrations/subo.md`.

---

## Traps that have already bitten

Each of these shipped once. They are fixed; they are listed so the same shape
is recognised next time.

### `http.get<Paginated<T>>` returns a bare array
The envelope splits a page across `data` and `meta.pagination`. The typed call
lies, `.items` is `undefined`, and every list silently renders empty. **Use
`http.getPaginated`.** Four tests in `packages/api-client/tests/` pin this.

### An absolute URL without `/api/v1`
The Subo callback was advertised as `https://host/webhooks/subo`, which is the
static site. Build any URL back to the API with `apiUrl()` from
`backend/src/common/constants.ts`.

### A wildcard in a test that covers the bug
The callback-URL test matched `https://*/webhooks/subo`, which is true of both
the right URL and the broken one. A pattern whose wildcard sits exactly where
the defect is proves nothing.

### Digit-stripping search matched too much
Phone search strips non-digits, which is right for `+998 90 123 45 67` and
wrong for a name containing a number — `YOQSHUNAQAODAM999` matched every phone
containing 999. The rule is now "no letters at all", not "has three digits".

### A type that disagrees with its Zod schema
`deliveryRadiusM`, `description`, `imageUrl` all had schemas accepting `null`
(to clear a value) while the TS request type said `string | undefined`. The
schema is the contract; make the type match it.

### Expo's release build signs with the DEBUG key
Two edits are needed — declaring a `release` signing config AND pointing the
buildType at it. Doing only the second fails at gradle evaluation; doing
neither ships an APK that cannot be updated from another machine. The build
script now does both and verifies the signature afterwards.

### `*/` inside a URL in a block comment
Writing `https://*/path` in a `/** */` comment closes the comment early and the
rest of the file parses as code.

### `.Replace()` in PowerShell replaces every occurrence
Used to add a Prisma back-relation, it added the same line to three models.
Prefer the Edit tool with unique surrounding context.

### Commit messages through PowerShell
Quotes and non-ASCII characters in `git commit -m` get mangled. Write the
message to a file and use `git commit -F`.
