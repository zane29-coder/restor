#!/usr/bin/env bash
# =============================================================================
# RESTOR — deploy onto a server that ALREADY runs other sites.
#
#   ./infrastructure/deployment/deploy-shared-host.sh
#
# Unlike deploy.sh, this does NOT run its own nginx and does NOT claim ports
# 80/443. It builds the web bundles, publishes them under /var/www/restor,
# starts the API on loopback, and adds one site file to the host's existing
# nginx.
#
# Each app is served from its own sub-domain (restor.uz, app., pos., kds., tg.,
# api.). Run init-ssl-host.sh once first — the site config references the
# certificate and will not load without it.
#
# Every change is additive. The only shared file touched is nginx's config
# directory, and the config is validated with `nginx -t` before any reload —
# so a mistake here cannot take the other sites down.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

DOMAIN="${RESTOR_DOMAIN:-restor.uz}"
WEB_ROOT="/var/www/restor"
COMPOSE="docker compose -f docker-compose.server.yml --env-file .env.server"

# One host per app — see infrastructure/nginx/host/restor.conf. The API host is
# verified separately because it answers /health and not an index.html.
API_HOST="api.$DOMAIN"
WEB_HOSTS=("$DOMAIN" "app.$DOMAIN" "pos.$DOMAIN" "kds.$DOMAIN" "tg.$DOMAIN")

log()  { printf '\033[0;34m▸\033[0m %s\n' "$1"; }
ok()   { printf '\033[0;32m✔\033[0m %s\n' "$1"; }
fail() { printf '\033[0;31m✖\033[0m %s\n' "$1" >&2; exit 1; }

SKIP_WEB=false
SKIP_API=false
for arg in "$@"; do
  case "$arg" in
    --api-only) SKIP_WEB=true ;;
    --web-only) SKIP_API=true ;;
    *) fail "Unknown flag: $arg" ;;
  esac
done

# --- Preflight ---------------------------------------------------------------
log 'Checking prerequisites'
command -v docker >/dev/null || fail 'docker is not installed'
command -v node   >/dev/null || fail 'node is not installed'
[[ -f .env.server ]]         || fail '.env.server is missing'
[[ -f backend/.env.server ]] || fail 'backend/.env.server is missing'
grep -q 'CHANGE_ME' .env.server backend/.env.server 2>/dev/null \
  && fail 'Placeholder secrets are still present'
ok 'Prerequisites OK'

# --- Web bundles -------------------------------------------------------------
if [[ "$SKIP_WEB" == false ]]; then
  log 'Installing dependencies'
  npm ci --ignore-scripts --no-audit --no-fund

  log 'Building shared packages'
  npm run build:packages

  # Same-origin API: every app host proxies /api/ to the same backend, so there
  # is no CORS preflight anywhere and no app has to know its own domain.
  export VITE_API_URL=/api/v1

  # Every app now owns a sub-domain, so each is mounted at the root of its own
  # host and `--base=/` is correct for all of them. (Under the old path-based
  # layout each needed a matching `--base=/admin/`, `/pos/`, … or its asset URLs
  # resolved against the domain root and 404'd.)
  log 'Building web apps'
  ( cd apps/customer-web      && npx vite build --base=/ )
  ( cd apps/admin-web         && npx vite build --base=/ )
  ( cd apps/pos               && npx vite build --base=/ )
  ( cd apps/kitchen-display   && npx vite build --base=/ )
  ( cd apps/telegram-mini-app && npx vite build --base=/ )

  log "Publishing to $WEB_ROOT"
  sudo mkdir -p "$WEB_ROOT"/{customer,admin,pos,kds,miniapp}
  # --delete so a file removed from a build stops being served.
  sudo rsync -a --delete apps/customer-web/dist/      "$WEB_ROOT/customer/"
  sudo rsync -a --delete apps/admin-web/dist/         "$WEB_ROOT/admin/"
  sudo rsync -a --delete apps/pos/dist/               "$WEB_ROOT/pos/"
  sudo rsync -a --delete apps/kitchen-display/dist/   "$WEB_ROOT/kds/"
  sudo rsync -a --delete apps/telegram-mini-app/dist/ "$WEB_ROOT/miniapp/"

  # Product images live in the repo and are served straight off disk.
  mkdir -p storage
  sudo ln -sfn "$REPO_ROOT/storage" "$WEB_ROOT/uploads"

  sudo chown -R www-data:www-data "$WEB_ROOT" 2>/dev/null || true
  ok 'Web bundles published'
fi

# --- API ---------------------------------------------------------------------
if [[ "$SKIP_API" == false ]]; then
  log 'Building the API image'
  $COMPOSE build api

  log 'Starting Postgres and Redis'
  $COMPOSE up -d postgres redis

  log 'Waiting for Postgres'
  for _ in $(seq 1 30); do
    $COMPOSE exec -T postgres pg_isready -q && break
    sleep 2
  done

  log 'Starting the API (applies migrations on boot)'
  $COMPOSE up -d api

  log 'Waiting for the API to become healthy'
  for attempt in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${API_HOST_PORT:-3100}/health" >/dev/null 2>&1; then
      ok 'API is healthy'
      break
    fi
    [[ "$attempt" -eq 30 ]] && { $COMPOSE logs --tail=80 api; fail 'API did not start'; }
    sleep 3
  done
fi

# --- nginx -------------------------------------------------------------------
log 'Installing the nginx site'

# The certificate must already exist: the site config references
# /etc/letsencrypt/live/restor.uz/ and `nginx -t` fails without it. Checking
# here gives a clear message instead of a config-test dump.
#
# `sudo test` rather than `[[ -s ]]`: the live/ symlink points into
# /etc/letsencrypt/archive/, which is mode 0700, so an unprivileged stat through
# it fails even when the certificate is there.
if ! sudo test -s "/etc/letsencrypt/live/$DOMAIN/fullchain.pem"; then
  fail "No certificate for $DOMAIN — run infrastructure/deployment/init-ssl-host.sh first"
fi

sudo install -m 644 infrastructure/nginx/host/restor-ratelimit.conf /etc/nginx/conf.d/restor-ratelimit.conf
sudo mkdir -p /etc/nginx/snippets
for snippet in restor-proxy restor-tls restor-headers restor-spa; do
  sudo install -m 644 "infrastructure/nginx/host/$snippet.conf" "/etc/nginx/snippets/$snippet.conf"
done
sudo install -m 644 infrastructure/nginx/host/restor.conf /etc/nginx/sites-available/restor
sudo ln -sfn /etc/nginx/sites-available/restor /etc/nginx/sites-enabled/restor

# Validate BEFORE reloading. A broken config would otherwise take down every
# site on this server, not just RESTOR.
if ! sudo nginx -t; then
  log 'Config is invalid — removing the RESTOR site and leaving nginx untouched'
  sudo rm -f /etc/nginx/sites-enabled/restor
  fail 'nginx config test failed'
fi

sudo systemctl reload nginx
ok 'nginx reloaded'

# --- Verify ------------------------------------------------------------------
# One check per host. A certificate covering every name and an nginx that
# reloaded cleanly still leave room for a vhost pointing at an empty directory,
# and that is exactly the failure a deploy should catch rather than a user.
log 'Verifying'

curl -fsS "https://$API_HOST/health" >/dev/null \
  && ok "https://$API_HOST/health responds" \
  || fail "https://$API_HOST/health did not respond"

for host in "${WEB_HOSTS[@]}"; do
  # --head: the index page, not its contents. A vhost whose root is missing
  # answers 403/404 here instead of 200.
  if curl -fsS --head "https://$host/" >/dev/null; then
    ok "https://$host/ serves"
  else
    fail "https://$host/ did not serve — check /var/log/nginx/restor-*-error.log"
  fi
done

$COMPOSE ps
ok "Deploy complete — https://$DOMAIN"
printf '  %s\n' "admin: https://app.$DOMAIN" "POS: https://pos.$DOMAIN" \
  "KDS: https://kds.$DOMAIN" "Mini App: https://tg.$DOMAIN" "API: https://$API_HOST"
