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
# Every change is additive. The only shared file touched is nginx's config
# directory, and the config is validated with `nginx -t` before any reload —
# so a mistake here cannot take the other sites down.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

DOMAIN="${RESTOR_DOMAIN:-restore-1.duckdns.org}"
WEB_ROOT="/var/www/restor"
COMPOSE="docker compose -f docker-compose.server.yml --env-file .env.server"

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

  # Same-origin API behind the host nginx, so no CORS preflight anywhere.
  export VITE_API_URL=/api/v1

  # Each sub-path app is built with a matching `--base`, or its asset URLs
  # would resolve against the domain root and 404.
  log 'Building web apps'
  ( cd apps/customer-web      && npx vite build --base=/ )
  ( cd apps/admin-web         && npx vite build --base=/admin/ )
  ( cd apps/pos               && npx vite build --base=/pos/ )
  ( cd apps/kitchen-display   && npx vite build --base=/kds/ )
  ( cd apps/telegram-mini-app && npx vite build --base=/tg/ )

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

sudo install -m 644 infrastructure/nginx/host/restor-ratelimit.conf /etc/nginx/conf.d/restor-ratelimit.conf
sudo mkdir -p /etc/nginx/snippets
sudo install -m 644 infrastructure/nginx/host/restor-proxy.conf /etc/nginx/snippets/restor-proxy.conf
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
log 'Verifying'
curl -fsS "https://$DOMAIN/health" >/dev/null && ok "https://$DOMAIN/health responds"

$COMPOSE ps
ok "Deploy complete — https://$DOMAIN"
