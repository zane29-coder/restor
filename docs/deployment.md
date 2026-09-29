# Deployment

Deploying RESTOR to a single VPS: Docker Compose, nginx, Let's Encrypt.

Written for: whoever operates the server. Assumes comfort with SSH and DNS, not
with this codebase.

---

## What gets deployed

| Component | How it runs | Exposed |
| --- | --- | --- |
| API (NestJS) | Docker container | Only via nginx |
| PostgreSQL | Docker container | **Internal network only** |
| Redis | Docker container | **Internal network only** |
| nginx | Docker container | 80, 443 |
| certbot | Docker container | — (renews certificates) |
| Web apps | Static bundles built on the server, served by nginx | Via nginx |
| Courier app | APK built by EAS, distributed separately | — |

Only nginx publishes ports. Postgres and Redis are unreachable from the
internet even if the firewall is later misconfigured, because they are never
bound to a host port.

---

## 1. Requirements

**Server:** Ubuntu 22.04/24.04 or Debian 12.

| Load | CPU | RAM | Disk |
| --- | --- | --- | --- |
| 1 restaurant, a few branches | 2 vCPU | 4 GB | 40 GB |
| 10+ tenants | 4 vCPU | 8 GB | 80 GB |

2 GB works with the swap the setup script adds, but builds are slow. 4 GB is
the realistic floor.

**DNS** — point these A records at the server's IP before starting:

| Record | Purpose |
| --- | --- |
| `restor.uz` | Customer storefront |
| `www.restor.uz` | Redirect |
| `api.restor.uz` | API |
| `admin.restor.uz` | Admin panel, POS, KDS |

Wait for propagation (`dig +short restor.uz`) before requesting certificates —
Let's Encrypt validates over HTTP and will fail otherwise.

---

## 2. Prepare the server

```bash
ssh root@YOUR_SERVER_IP
git clone <your-repo> /opt/restor && cd /opt/restor
chmod +x infrastructure/deployment/*.sh
sudo ./infrastructure/deployment/server-setup.sh
```

This installs Docker and Node 22, creates a non-root `restor` user, enables a
firewall limited to 22/80/443, turns on fail2ban and unattended security
updates, and adds swap on a small box.

**It also disables SSH password authentication.** Confirm your key works in a
second terminal before closing the first one.

---

## 3. Configure

```bash
su - restor
git clone <your-repo> ~/restor && cd ~/restor

cp .env.prod.example .env.prod
cp backend/.env.example backend/.env.prod
```

Generate the secrets:

```bash
# JWT secrets — must differ from each other
node -e "console.log('JWT_ACCESS_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('JWT_REFRESH_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"

# Encryption key for bot tokens and provider keys — exactly 32 bytes
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"

# Database and Redis passwords
openssl rand -base64 32
```

`backend/.env.prod` must set at least:

```ini
NODE_ENV=production
PORT=3000
CORS_ORIGINS=https://restor.uz,https://admin.restor.uz
API_BASE_URL=https://api.restor.uz
CUSTOMER_WEB_URL=https://restor.uz

JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...
ENCRYPTION_KEY=...

STORAGE_PROVIDER=LOCAL
LOG_LEVEL=info
LOG_PRETTY=false
```

`DATABASE_URL` and `REDIS_URL` are injected by Compose — leave them out.

The API **refuses to start** if `CORS_ORIGINS` is empty or `*` in production,
if the two JWT secrets match, if a secret is under 32 characters, or if
`ENCRYPTION_KEY` is missing. That is deliberate: a misconfiguration should stop
the deploy, not surface as a breach later.

---

## 4. Certificates

```bash
./infrastructure/deployment/init-ssl.sh
```

Runs once. It stands up a temporary HTTP-only nginx (the real config references
certificates that do not exist yet), requests one certificate covering all four
hostnames, then tears the temporary server down. Renewal afterwards is handled
by the `certbot` container.

If it fails, DNS almost certainly has not propagated. Check with
`dig +short api.restor.uz` and retry.

---

## 5. Deploy

```bash
./infrastructure/deployment/deploy.sh
```

The script checks prerequisites and refuses to continue while placeholder
secrets remain, builds the shared packages and all five web bundles, publishes
them to the nginx web root, builds and starts the API (which applies
migrations on boot), reloads nginx after validating its config, and polls
`/health` until the API answers — dumping logs and failing if it does not.

Flags: `--api-only` and `--web-only` for a partial deploy.

---

## 6. Create the first tenant

The production database has no seed data. Create the platform administrator
once, from the server:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec api node -e "
const { PrismaClient } = require('@prisma/client');
const { hash } = require('@node-rs/argon2');
const { ALL_PERMISSIONS, PERMISSION_GROUPS } = require('@restor/shared-types');
const db = new PrismaClient();

(async () => {
  const groupOf = (code) => Object.entries(PERMISSION_GROUPS)
    .find(([, list]) => list.includes(code))?.[0] ?? 'Other';

  for (const code of ALL_PERMISSIONS) {
    await db.permission.upsert({ where: { code }, create: { code, group: groupOf(code) }, update: {} });
  }

  let role = await db.role.findFirst({ where: { tenantId: null, code: 'SUPER_ADMIN' } });
  role ??= await db.role.create({
    data: { tenantId: null, code: 'SUPER_ADMIN', name: 'Super Admin', isSystem: true },
  });

  const permissions = await db.permission.findMany({ select: { id: true } });
  await db.rolePermission.createMany({
    data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
    skipDuplicates: true,
  });

  await db.user.create({
    data: {
      tenantId: null,
      phone: process.env.ADMIN_PHONE,
      passwordHash: await hash(process.env.ADMIN_PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
      fullName: 'Platform Administrator',
      roles: { create: [{ roleId: role.id }] },
    },
  });

  console.log('Super admin created:', process.env.ADMIN_PHONE);
  await db.\$disconnect();
})();
"
```

Pass the credentials as environment variables so they never reach the shell
history:

```bash
read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD
export ADMIN_PHONE='+998901234567'
```

Then sign in at `https://admin.restor.uz` and create the first restaurant
through **Platform → Tenants**, which provisions its owner, its roles and its
subscription in one transaction.

---

## 7. Backups

```bash
crontab -e
# Nightly at 03:00
0 3 * * * cd /home/restor/restor && ./infrastructure/deployment/backup.sh >> /var/log/restor-backup.log 2>&1
```

The script dumps, gzips, **verifies the archive is readable**, prunes anything
older than 14 days, and optionally uploads to S3 when `BACKUP_S3_BUCKET` is
set.

A backup on the same disk as the database survives a bad migration but not a
dead server. Set `BACKUP_S3_BUCKET`, and restore one onto a staging database at
least once — an untested backup is a hope, not a backup.

---

## Operations

```bash
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"

$C ps                      # status
$C logs -f api             # follow API logs
$C logs --tail=100 nginx   # recent nginx logs
$C restart api             # restart the API
$C exec postgres psql -U restor -d restor    # database shell

curl https://api.restor.uz/health            # liveness
curl https://api.restor.uz/health/ready      # readiness (checks the DB)
```

### Updating

```bash
cd ~/restor
git pull
./infrastructure/deployment/deploy.sh
```

Migrations run automatically when the API container starts. `prisma migrate
deploy` is idempotent, so a rolling restart is safe.

### After adding a permission

Permissions are baked into the access token, and existing tenants were seeded
with the old set:

```bash
$C exec api npm run db:sync-roles
```

Staff must sign in again for the change to reach their tokens.

---

## Troubleshooting

**API will not start.** `$C logs api`. Almost always environment validation —
the message names the offending variable. It is a deliberate hard failure.

**502 from nginx.** The API is down or still booting. `$C ps`, then
`$C logs api`.

**Certificate renewal fails.** `$C logs certbot`. Port 80 must stay reachable:
the ACME challenge is served over plain HTTP, which is why `restor.conf` keeps
a `/.well-known/acme-challenge/` location outside the HTTPS redirect.

**WebSocket disconnects every minute.** A proxy in front of nginx (Cloudflare,
a load balancer) is timing the connection out. `restor.conf` sets
`proxy_read_timeout 3600s` for `/realtime/`; the upstream proxy needs the same.

**Out of memory during a build.** Build the bundles elsewhere and rsync
`apps/*/dist` up, then run `deploy.sh --api-only`.

---

## Scaling past one server

The current setup runs one API container and serves uploads from a local
volume. Before adding a second:

1. **Switch storage to S3 or MinIO** (`STORAGE_PROVIDER=S3`). Local disk is not
   shared between containers, so images uploaded by one replica would 404 on
   the other.
2. **Move Socket.IO to the Redis adapter**, or sticky sessions will be needed
   to keep a client on the node holding its room.
3. **Move Postgres to a managed instance** with its own backups and replica.
4. Put the API containers behind the existing nginx and scale with
   `$C up -d --scale api=3`.
