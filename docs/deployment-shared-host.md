# Deployment — shared host, one sub-domain per app

Adding RESTOR to a server that **already runs other sites**: the host's own
nginx stays in charge of ports 80 and 443, and RESTOR contributes server blocks
to it.

Written for: whoever operates the server. Assumes comfort with SSH, DNS and
`systemctl`, not with this codebase.

For a server dedicated to RESTOR, use [deployment.md](deployment.md) instead —
that stack runs its own nginx container and claims both ports. Pick one; running
both means two processes fighting over port 443.

---

## The layout

| Host | Serves | Built from |
| --- | --- | --- |
| `restor.uz` | Customer storefront | `apps/customer-web` |
| `www.restor.uz` | 301 to the apex | — |
| `app.restor.uz` | Admin panel | `apps/admin-web` |
| `pos.restor.uz` | POS terminal | `apps/pos` |
| `kds.restor.uz` | Kitchen display | `apps/kitchen-display` |
| `tg.restor.uz` | Telegram Mini App | `apps/telegram-mini-app` |
| `api.restor.uz` | `/api/v1`, `/realtime`, `/uploads`, `/health` | `backend` |

The courier app is an Android APK with no web build, so it has no host of its
own — it calls `api.restor.uz`.

**Every app host also proxies `/api/`, `/realtime/` and `/uploads/` to the same
backend.** That is what makes the API same-origin for the browser: no CORS
preflight on any request, no third-party-cookie rules, and nothing to
reconfigure when a sub-domain is added. Each app ships with
`VITE_API_URL=/api/v1` and never learns its own domain.

`api.restor.uz` exists for the clients that cannot be same-origin: the courier
APK and the payment provider's callbacks.

### Which restaurant does `restor.uz` show?

The storefront is multi-tenant, so the bare apex is not by itself a restaurant.
The tenant is resolved in this order (TZ §47, §49):

| Form | Example | Set up by |
| --- | --- | --- |
| Path | `restor.uz/r/demo` | Nothing — works out of the box |
| QR token | `restor.uz/t/{token}` | **Tables → QR** |
| White-label domain | `order.demo.uz` | **Tenant → domain**, plus that domain's own DNS, server block and certificate |

So `https://restor.uz/` with no path shows a restaurant only if a tenant has
`domain = restor.uz` — which is how a single-restaurant deployment serves its
storefront from the bare domain. Set it under **Platform → Tenants → the tenant
→ domain**. Otherwise the apex is a platform address and customers reach a
restaurant through a path or a QR code.

The backend also resolves `demo.restor.uz` → tenant `demo` from the leading
label, but **nothing serves that host yet**: it needs a wildcard `*.restor.uz`
A record, a catch-all server block, and a wildcard certificate — which
Let's Encrypt only issues over DNS-01, not the HTTP-01 challenge used here.

The app sub-domains (`app`, `pos`, `kds`, `tg`, `api`, `www`) are **never**
read as tenant slugs, and tenant creation will not hand those names out — a
restaurant called "App" is slugged `app-2`. Without that, `pos.restor.uz` would
resolve to a tenant slugged `pos` on every unauthenticated request. The list
lives in `backend/src/common/constants.ts`.

### Why not one domain with sub-paths

This used to be `restore-1.duckdns.org/admin/`, `/pos/`, `/kds/`, `/tg/`. One
name and one certificate is genuinely simpler, and it is the right answer while
a deployment is a single DuckDNS host. It stops being the right answer once
there is a real domain:

- Every bundle has to be built with a matching `--base=/admin/`, and an app
  built with the wrong base loads a white page with four 404s in the console.
- A kiosk browser pointed at `/kds/` can be navigated to `/admin/`.
- All five apps share one cookie scope and one access log.
- A staff member has to remember a path, not a name.

The cost of sub-domains is one DNS record per app and one more name on the
certificate. Both are paid once.

---

## 1. DNS

Point an A record for each host at the server's IP:

```
restor.uz        A  <server IP>
www.restor.uz    A  <server IP>
api.restor.uz    A  <server IP>
app.restor.uz    A  <server IP>
pos.restor.uz    A  <server IP>
kds.restor.uz    A  <server IP>
tg.restor.uz     A  <server IP>
```

Verify every one before going further — Let's Encrypt validates over HTTP from
the outside, and a single name that does not resolve fails the whole request,
including the names that would have worked:

```bash
for h in restor.uz www.restor.uz api.restor.uz app.restor.uz pos.restor.uz kds.restor.uz tg.restor.uz; do
  printf '%-18s %s\n' "$h" "$(dig +short "$h" | tail -1)"
done
```

---

## 2. Configure

```bash
cd /opt/restor          # wherever the checkout lives on this server
git pull
chmod +x infrastructure/deployment/*.sh    # the repo does not carry the bit

cp .env.server.example .env.server
cp backend/.env.server.example backend/.env.server
```

Generate the secrets:

```bash
# JWT secrets — must differ from each other
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# Encryption key for bot tokens and provider keys — exactly 32 bytes
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Database and Redis passwords
openssl rand -base64 32
```

Already running? Then `.env.server` and `backend/.env.server` exist and only
these three values need changing, because they are the ones that name the public
hosts:

```ini
# backend/.env.server
CORS_ORIGINS=https://restor.uz,https://www.restor.uz,https://app.restor.uz,https://pos.restor.uz,https://kds.restor.uz,https://tg.restor.uz
API_BASE_URL=https://api.restor.uz
CUSTOMER_WEB_URL=https://restor.uz
```

Keep `JWT_*` and `ENCRYPTION_KEY` as they are. Rotating the JWT secrets signs
everyone out; rotating `ENCRYPTION_KEY` orphans every bot token and provider key
already encrypted with the old one.

The API **refuses to start** if `CORS_ORIGINS` is empty or `*` in production, if
the two JWT secrets match, if a secret is under 32 characters, or if
`ENCRYPTION_KEY` is missing. A misconfiguration should stop the deploy, not
surface as a breach later.

---

## 3. Certificate

```bash
sudo ./infrastructure/deployment/init-ssl-host.sh
```

Run once. It checks that every name resolves here, installs a temporary port-80
vhost so the ACME challenge can be answered for names that have no server block
yet, requests **one** certificate covering all seven, then removes the temporary
vhost.

`--cert-name restor.uz` pins the result to `/etc/letsencrypt/live/restor.uz/`,
which is the path the nginx snippet references. Without it, adding a name later
makes certbot create `restor.uz-0001` and nginx goes on quietly serving the old
certificate until it expires.

Renewal runs from the host's existing certbot timer; the deploy hook reloads
nginx. Check it with `sudo certbot renew --dry-run`.

The existing `restore-1.duckdns.org` certificate is left alone — it is still in
use (see [step 6](#6-the-old-host)).

---

## 4. Deploy

```bash
./infrastructure/deployment/deploy-shared-host.sh
```

It builds the shared packages and all five bundles with `--base=/`, publishes
them under `/var/www/restor/`, builds and starts the API on `127.0.0.1:3100`
(applying migrations on boot), installs the nginx site and its snippets,
validates with `nginx -t` **before** reloading, and then checks every host
answers.

Flags: `--api-only`, `--web-only`.

The config test is the important part: this nginx serves other people's sites
too. If the test fails the script removes RESTOR's site file and leaves nginx
untouched, so the worst case is that RESTOR does not come up — not that
everything else goes down.

What gets installed:

| File | Purpose |
| --- | --- |
| `/etc/nginx/sites-available/restor` | The server blocks |
| `/etc/nginx/conf.d/restor-ratelimit.conf` | Rate-limit zones, upstream, cache map (`http` context) |
| `/etc/nginx/snippets/restor-proxy.conf` | `proxy_pass` + forwarded headers |
| `/etc/nginx/snippets/restor-tls.conf` | Certificate paths + certbot's TLS profile |
| `/etc/nginx/snippets/restor-headers.conf` | Security and cache headers |
| `/etc/nginx/snippets/restor-spa.conf` | Same-origin API + SPA fallback |

Every name is prefixed `restor_` or `restor-` so it cannot collide with
something another site on this server has already defined.

---

## 5. Finish the move

Three things live outside the repository and do not change when nginx does.

### Image URLs already in the database

`imageUrl`, `logoUrl`, `faviconUrl` and `avatarUrl` are stored as **absolute**
URLs, built from `API_BASE_URL` at upload time. Rows written while the old host
was public still point at it. Rewrite them once:

```bash
C="docker compose -f docker-compose.server.yml --env-file .env.server"
# -T: without it compose allocates a TTY and the here-document never reaches psql.
$C exec -T postgres psql -U restor -d restor <<'SQL'
BEGIN;
UPDATE products   SET "imageUrl"   = replace("imageUrl",   'https://restore-1.duckdns.org', 'https://api.restor.uz') WHERE "imageUrl"   LIKE 'https://restore-1.duckdns.org%';
UPDATE categories SET "imageUrl"   = replace("imageUrl",   'https://restore-1.duckdns.org', 'https://api.restor.uz') WHERE "imageUrl"   LIKE 'https://restore-1.duckdns.org%';
UPDATE tenants    SET "logoUrl"    = replace("logoUrl",    'https://restore-1.duckdns.org', 'https://api.restor.uz') WHERE "logoUrl"    LIKE 'https://restore-1.duckdns.org%';
UPDATE tenants    SET "faviconUrl" = replace("faviconUrl", 'https://restore-1.duckdns.org', 'https://api.restor.uz') WHERE "faviconUrl" LIKE 'https://restore-1.duckdns.org%';
UPDATE users      SET "avatarUrl"  = replace("avatarUrl",  'https://restore-1.duckdns.org', 'https://api.restor.uz') WHERE "avatarUrl"  LIKE 'https://restore-1.duckdns.org%';
COMMIT;
SQL
```

Take a backup first (`./infrastructure/deployment/backup.sh`). Until this has
run, those images load because the old host still serves `/uploads/`.

### The Telegram Mini App URL

In [@BotFather](https://t.me/BotFather): `/newapp` → the bot → set the Web App
URL to `https://tg.restor.uz`, and the same under Bot Settings → Menu Button.
Nothing in the backend reads this, so nothing warns you if it is stale — the
Mini App simply keeps opening the old host.

### Dine-in QR codes

`CUSTOMER_WEB_URL` builds the `/t/{qrToken}` links, so QR codes generated from
now on carry `https://restor.uz`. **Codes already printed and glued to tables
carry the old host** and keep working only while it answers. Reprint them from
**Tables → QR** before retiring that host.

### The courier APK

`expo.extra.apiUrl` is baked into the binary. Version 0.2.1 points at
`https://api.restor.uz/api/v1`; build and distribute it per
[the courier README](../apps/courier-mobile/README.md#building-the-apk). Phones
still on 0.2.0 keep working until the old host is retired.

---

## 6. The old host

`restore-1.duckdns.org` is kept deliberately, as a transitional block in
`infrastructure/nginx/host/restor.conf`:

- `/api/`, `/realtime/` and `/uploads/` still proxy to the same backend — a
  released APK has that host compiled in, and a 301 is not a fix, because an
  HTTP client is not required to replay a POST body against the new location.
- `/admin/`, `/pos/`, `/kds/`, `/tg/` and `/` redirect to their new hosts, so
  bookmarks land in the right place.

Remove the block once **all** of these are true: every courier runs 0.2.1 or
later, the image URLs above have been rewritten, and every printed QR code has
been reprinted. Then delete the block, redeploy, and let the DuckDNS
certificate lapse.

Watch what is still arriving there:

```bash
sudo tail -f /var/log/nginx/restor-legacy-access.log
```

---

## Operations

```bash
C="docker compose -f docker-compose.server.yml --env-file .env.server"

$C ps                                        # status
$C logs -f api                               # follow API logs
$C restart api                               # restart the API
$C exec postgres psql -U restor -d restor    # database shell

curl https://api.restor.uz/health            # liveness
curl https://api.restor.uz/health/ready      # readiness (checks the DB)

sudo tail -f /var/log/nginx/restor-admin-error.log   # one log per app
```

Each host writes its own pair of logs: `restor-api-`, `restor-customer-`,
`restor-admin-`, `restor-pos-`, `restor-kds-`, `restor-tg-`, `restor-legacy-`.
That separation is half the point of the sub-domains — "the kitchen screens
stopped updating" is a question you can answer from one file.

### Updating

```bash
cd ~/restor && git pull
./infrastructure/deployment/deploy-shared-host.sh
```

---

## Troubleshooting

**`nginx -t` fails on `restor-tls.conf`.** The certificate is missing. Run
`init-ssl-host.sh`. The deploy script checks for it first and says so.

**One host serves a white page, the others are fine.** Its bundle was built with
the wrong `--base`, or its directory under `/var/www/restor/` is empty. Check
the browser console for 404s on `/assets/*.js`, then
`ls /var/www/restor/{customer,admin,pos,kds,miniapp}`.

**A host shows another site on this server.** nginx found no matching
`server_name` and fell through to the default server. Either the DNS record is
missing, or that name is not in `restor.conf` — `courier.restor.uz` is exactly
this case, and is commented out there on purpose.

**502 on `/api/`.** The API is down or still booting: `$C ps`, then
`$C logs api`. Almost always environment validation, and the message names the
variable.

**Images 404 after the move.** `API_BASE_URL` and the stored URLs disagree. See
[step 5](#image-urls-already-in-the-database).

**The Mini App opens a blank sheet.** Something is sending `X-Frame-Options` on
`tg.restor.uz`. That vhost must not — Telegram renders the Mini App in a frame.

**Certificate renewal fails.** `sudo certbot renew --dry-run`. Port 80 must stay
reachable: the ACME challenge is served over plain HTTP, which is why the
port-80 block keeps `/.well-known/acme-challenge/` outside the HTTPS redirect.

**WebSocket disconnects every minute.** A proxy in front of nginx (Cloudflare, a
load balancer) is timing the connection out. The config sets
`proxy_read_timeout 3600s` for `/realtime/`; the upstream proxy needs the same.

**Out of memory during a build.** Build the bundles elsewhere and rsync
`apps/*/dist` up, then run `deploy-shared-host.sh --api-only`.

---

## Adding a host later

`courier.restor.uz` is the worked example — a commented block at the bottom of
`infrastructure/nginx/host/restor.conf`.

1. Add the A record.
2. Add the name to `CERT_DOMAINS` in `init-ssl-host.sh` and re-run it. `--expand`
   adds it to the existing certificate rather than issuing a second one.
3. Add the server block, and the origin to `CORS_ORIGINS` if a browser will use
   it.
4. `./infrastructure/deployment/deploy-shared-host.sh`
