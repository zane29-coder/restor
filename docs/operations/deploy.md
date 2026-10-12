# Shipping a change

For a server that is already running. First-time setup is
[deploy-setup.md](deploy-setup.md); the machines themselves are
[servers.md](servers.md).

## Normal path: GitHub Actions

Push or merge to `main`. `.github/workflows/ci-cd.yml` builds every package and
app, typechecks every workspace, and runs the backend unit tests. Deployment
starts only after all three pass.

The deploy job uses a restricted SSH identity. It can request only this fixed
operation:

```text
deploy <current-origin-main-sha>
```

The root-owned server entrypoint then:

1. verifies that the SHA is exactly the current public `origin/main`;
2. creates an isolated worktree under `/opt/restor-releases/<sha>`;
3. links the existing server-only env files and storage directory;
4. writes a PostgreSQL backup under
   `/opt/restor/infrastructure/database/backups/`;
5. runs `deploy-shared-host.sh`, including its health and nginx checks.

The CI key cannot open a shell, transfer files, forward ports, or ask the
server to deploy code that is not the current `main`. GitHub contains only the
dedicated private deploy key and the pinned SSH host key; application secrets
stay on the server.

Use the manual path below only while CI/CD is unavailable or for recovery.

Production is `169.58.84.241`, which **also runs eight other live sites**.
Read the rule in `servers.md` before touching nginx.

## Before you upload

```bash
npm run build:packages
npm run typecheck
cd backend && npm test
```

All three. A stale `packages/*/dist` is the most common cause of a confusing
failure.

## 1. Upload only what changed

Name the files explicitly. A `--exclude` once deleted `backend/src/modules/storage/`
because the pattern matched more than intended.

```powershell
cd D:\fast_food
$files = @(
  'backend/src/modules/<area>/...'
  'packages/shared-types/src/...'
  'packages/validation/src/...'
  'apps/admin-web/src/...'
)
tar -czf $sp\change.tgz $files
scp $sp\change.tgz root@169.58.84.241:/tmp/
ssh root@169.58.84.241 'cd /opt/restor && tar -xzf /tmp/change.tgz'
```

Never upload `backend/.env` — it is gitignored for a reason.

## 2. Back up, if there is a migration

```bash
ssh root@169.58.84.241 'cd /opt/restor && set -a && . ./.env.server && set +a &&
  docker compose -f docker-compose.server.yml --env-file .env.server \
  exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  | gzip > infrastructure/database/backups/pre-<change>-$(date +%Y%m%d-%H%M).sql.gz'
```

Even for an additive one.

## 3. Deploy

```bash
ssh root@169.58.84.241 'cd /opt/restor && bash infrastructure/deployment/deploy-shared-host.sh [flag]'
```

| Flag | Does | Use when |
| --- | --- | --- |
| `--api-only` | Rebuilds the API image, restarts it, runs migrations | Backend only |
| `--web-only` | Rebuilds the Vite apps, rsyncs to `/var/www/restor` | Frontend only |
| *(none)* | Both | A change spans them, or you are unsure |

`bash <script>`, not `./<script>` — the file is not executable on the server.

Migrations run on container start (`prisma migrate deploy`, idempotent), so
`--api-only` applies them. Waiting for the health check means a migration
failure surfaces as a failed deploy rather than a crash loop.

The script validates nginx with `nginx -t` **before** reloading and removes the
RESTOR site rather than reloading a broken config. Eight other sites depend on
that.

## 4. Verify

Do not stop at "deploy complete".

```bash
curl https://restore-1.duckdns.org/health
powershell -NoProfile -File backend\tests\<area>-smoke.ps1
```

If a migration ran, confirm it landed:

```sql
SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 3;
```

Twice in this project a change typechecked, built, deployed cleanly and was
still wrong. The smoke test is what caught it.

## 5. Commit

```bash
git add -A
git commit -F <message-file>
```

`-F`, not `-m`: quotes and non-ASCII in a PowerShell `-m` get mangled.

## Changes that need an extra step

### A new permission

Adding it to `rbac.ts` and seeding it is not enough for an existing server —
the seed does not re-run. Grant it with SQL and verify:

```sql
INSERT INTO permissions (id, code, "group", description, "createdAt")
VALUES (gen_random_uuid(), '<code>', '<Group>', '<desc>', NOW())
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions ("roleId", "permissionId")
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE p.code = '<code>' AND r.code IN ('OWNER','COMPANY_ADMIN')
  AND r."deletedAt" IS NULL
ON CONFLICT DO NOTHING;
```

Write it to a file and `scp` it — nested quoting through ssh mangles. Users
pick it up on their next token refresh.

### A new shared package export

`npm run build:packages` on the server happens inside the deploy, but the API
Docker image builds only `shared-types`, `shared-utils` and `validation`
(`build:packages:api`). `api-client` and `ui` are browser packages and are not
in the image — importing one from the backend will fail there while working
locally.

### A courier app change

Not part of this deploy. See `apps/courier-mobile/README.md`.

## If the browser shows an old UI

The server is probably fine. Check before suspecting the code:

```bash
ssh root@169.58.84.241 'grep -l "<NewPageName>" /var/www/restor/admin/assets/*.js'
```

A hit means it is deployed and the browser is caching. Ctrl+Shift+R. See
`../context/KNOWN_ISSUES.md`.

## Rolling back

```bash
ssh root@169.58.84.241 'cd /opt/restor && git checkout <sha> -- <paths> &&
  bash infrastructure/deployment/deploy-shared-host.sh'
```

A migration does not roll back. Restore from the backup taken in step 2.
