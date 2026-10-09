# Servers

Two machines, both shared with other people's production work. **Every change
must be additive.**

## 169.58.84.241 — production

Runs RESTOR *and eight other live sites*. The host's own nginx owns ports 80
and 443; RESTOR does not run its own and does not claim them.

| | |
| --- | --- |
| Domain | `restore-1.duckdns.org` (test). `restor.uz` planned |
| Repo | `/opt/restor` |
| Web roots | `/var/www/restor/{customer,admin,pos,kds,miniapp}` |
| Containers | `restor-api` (127.0.0.1:3100), `restor-postgres`, `restor-redis` |
| nginx site | `/etc/nginx/sites-available/restor` |
| Backups | `/opt/restor/infrastructure/database/backups/` |
| Access | SSH key, `root@169.58.84.241` |

Postgres and Redis are **not** published to the host network. Only the API
listens, on loopback, behind nginx.

### The rule

Eight other businesses depend on this machine. Before any nginx change:
`nginx -t` first, reload second. The deploy script does this and removes the
RESTOR site rather than reloading a broken config — that has already saved
the other sites once.

Never `docker compose down` at the top level, never touch another project's
containers, never edit a shared config without a backup.

## 75.119.148.246 — build host

Also shared — `bj_mobile_api`, `telegram-saas`, `biznes_javon`, `faceid` and
others run here. RESTOR only borrows the Android toolchain.

| | |
| --- | --- |
| Purpose | Building the courier APK |
| Toolchain | JDK 17 + Android SDK 34 at `/opt/android-sdk` |
| Build dir | `/opt/restor-build` |
| Keystore | `/opt/restor-build/restor-courier.keystore` |
| Access | SSH key, `root@75.119.148.246` |

See `apps/courier-mobile/README.md` for the build.

**The keystore cannot be regenerated.** An update signed with a different key
installs as a different app — every courier would have to uninstall and
reinstall. A copy is in `release/` locally (gitignored). Keep one somewhere
off both machines.

## Secrets

Generated **on the server**, never committed.

| File | Holds |
| --- | --- |
| `/opt/restor/.env.server` | Postgres and Redis passwords, ports |
| `/opt/restor/backend/.env.server` | JWT secrets, `ENCRYPTION_KEY`, `API_BASE_URL` |

Both `chmod 600`. The two JWT secrets must differ from each other.
`ENCRYPTION_KEY` must be exactly 32 bytes — it decrypts stored bot tokens and
payment provider keys, so **losing or changing it makes every stored secret
unreadable**.

`backend/.env` locally is gitignored and must never be uploaded.

## Backups

Taken before every migration:

```bash
ssh root@169.58.84.241 'cd /opt/restor && set -a && . ./.env.server && set +a &&
  docker compose -f docker-compose.server.yml --env-file .env.server \
  exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  | gzip > infrastructure/database/backups/pre-<change>-$(date +%Y%m%d-%H%M).sql.gz'
```

Do this even for an additive migration. It costs seconds.

## Running SQL on the server

For anything with quotes or a heredoc, **write a script and scp it**. Nested
quoting through PowerShell → ssh → bash mangles reliably and silently.

```bash
scp script.sh root@169.58.84.241:/tmp/
ssh root@169.58.84.241 'bash /tmp/script.sh'
```

Keep those scripts ASCII-only for the same reason the smoke tests are.

## Health

```bash
curl https://restore-1.duckdns.org/health
ssh root@169.58.84.241 'cd /opt/restor && docker compose \
  -f docker-compose.server.yml --env-file .env.server ps'
ssh root@169.58.84.241 'cd /opt/restor && docker compose \
  -f docker-compose.server.yml --env-file .env.server logs --tail=80 api'
```
