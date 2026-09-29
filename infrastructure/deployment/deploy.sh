#!/usr/bin/env bash
# =============================================================================
# RESTOR — deploy to a single VPS.
#
#   ./infrastructure/deployment/deploy.sh            # full deploy
#   ./infrastructure/deployment/deploy.sh --api-only # backend only
#   ./infrastructure/deployment/deploy.sh --web-only # web bundles only
#
# Run from the repository root on the server.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"
WEB_ROOT="infrastructure/nginx/www"

API_ONLY=false
WEB_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --api-only) API_ONLY=true ;;
    --web-only) WEB_ONLY=true ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

log()  { printf '\033[0;34m▸\033[0m %s\n' "$1"; }
ok()   { printf '\033[0;32m✔\033[0m %s\n' "$1"; }
fail() { printf '\033[0;31m✖\033[0m %s\n' "$1" >&2; exit 1; }

# --- Preflight ---------------------------------------------------------------
# Checked before anything is built: a missing secret discovered after a
# five-minute image build is five wasted minutes.
log 'Checking prerequisites'
command -v docker >/dev/null || fail 'docker is not installed'
docker compose version >/dev/null 2>&1 || fail 'docker compose v2 is not available'
[[ -f .env.prod ]]          || fail '.env.prod is missing (copy .env.prod.example)'
[[ -f backend/.env.prod ]]  || fail 'backend/.env.prod is missing (copy backend/.env.example)'

if grep -q 'CHANGE_ME' .env.prod backend/.env.prod 2>/dev/null; then
  fail 'Placeholder secrets are still present in .env.prod — replace them'
fi
ok 'Prerequisites OK'

# --- Web bundles -------------------------------------------------------------
if [[ "$API_ONLY" == false ]]; then
  log 'Installing dependencies'
  npm ci --ignore-scripts

  log 'Building shared packages'
  npm run build:packages

  log 'Building web apps'
  # `VITE_API_URL=/api/v1` keeps the API same-origin behind nginx, so no CORS.
  export VITE_API_URL=/api/v1
  npm run build --workspace=@restor/admin-web
  npm run build --workspace=@restor/customer-web
  npm run build --workspace=@restor/pos
  npm run build --workspace=@restor/kitchen-display
  npm run build --workspace=@restor/telegram-mini-app

  log 'Publishing bundles to the nginx web root'
  mkdir -p "$WEB_ROOT"/{admin,customer,pos,kds,miniapp}
  # `--delete` so a file removed from a build does not linger and get served.
  rsync -a --delete apps/admin-web/dist/         "$WEB_ROOT/admin/"
  rsync -a --delete apps/customer-web/dist/      "$WEB_ROOT/customer/"
  rsync -a --delete apps/pos/dist/               "$WEB_ROOT/pos/"
  rsync -a --delete apps/kitchen-display/dist/   "$WEB_ROOT/kds/"
  rsync -a --delete apps/telegram-mini-app/dist/ "$WEB_ROOT/miniapp/"
  ok 'Web bundles published'
fi

# --- API ---------------------------------------------------------------------
if [[ "$WEB_ONLY" == false ]]; then
  log 'Building the API image'
  $COMPOSE build api

  log 'Starting infrastructure'
  $COMPOSE up -d postgres redis

  # The API container runs `prisma migrate deploy` on start, but waiting here
  # means a migration failure surfaces now rather than as a crash loop.
  log 'Waiting for Postgres'
  for _ in $(seq 1 30); do
    if $COMPOSE exec -T postgres pg_isready -q; then break; fi
    sleep 2
  done

  log 'Restarting the API'
  $COMPOSE up -d api
  ok 'API deployed'
fi

# --- Web server --------------------------------------------------------------
log 'Reloading nginx'
$COMPOSE up -d nginx certbot
# Validate before reloading: a bad config would otherwise take the site down.
$COMPOSE exec -T nginx nginx -t
$COMPOSE exec -T nginx nginx -s reload
ok 'nginx reloaded'

# --- Verify ------------------------------------------------------------------
log 'Verifying the API'
for attempt in $(seq 1 20); do
  if $COMPOSE exec -T api node -e \
      "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    ok 'API is healthy'
    break
  fi
  [[ "$attempt" -eq 20 ]] && {
    $COMPOSE logs --tail=60 api
    fail 'API did not become healthy — logs above'
  }
  sleep 3
done

$COMPOSE ps
ok 'Deploy complete'
