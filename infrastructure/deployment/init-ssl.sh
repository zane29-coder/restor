#!/usr/bin/env bash
# =============================================================================
# RESTOR — issue the first Let's Encrypt certificate.
#
#   ./infrastructure/deployment/init-ssl.sh
#
# Run ONCE, after DNS points at this server and before the first deploy.
# Renewal afterwards is handled by the `certbot` container in
# docker-compose.prod.yml.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

[[ -f .env.prod ]] || { echo '.env.prod is missing' >&2; exit 1; }
# shellcheck disable=SC1091
set -a; source .env.prod; set +a

: "${DOMAIN:?DOMAIN is not set in .env.prod}"
: "${CERTBOT_EMAIL:?CERTBOT_EMAIL is not set in .env.prod}"

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"

# One certificate covering every host, so nginx can reference a single path.
DOMAIN_ARGS=(-d "$DOMAIN" -d "www.$DOMAIN" -d "${API_DOMAIN:-api.$DOMAIN}" -d "${ADMIN_DOMAIN:-admin.$DOMAIN}")

log() { printf '\033[0;34m▸\033[0m %s\n' "$1"; }

log "Checking that DNS resolves to this server"
SERVER_IP="$(curl -fsS https://api.ipify.org || echo '')"
RESOLVED="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -n1 || echo '')"
if [[ -n "$SERVER_IP" && -n "$RESOLVED" && "$SERVER_IP" != "$RESOLVED" ]]; then
  echo "  ⚠ $DOMAIN resolves to $RESOLVED but this server is $SERVER_IP." >&2
  echo "    Let's Encrypt will fail until DNS has propagated." >&2
  read -r -p '  Continue anyway? [y/N] ' answer
  [[ "$answer" == [yY] ]] || exit 1
fi

# nginx must be serving plain HTTP for the ACME challenge, but its config
# references certificates that do not exist yet. A temporary HTTP-only config
# breaks that circular dependency.
log 'Starting nginx with a temporary HTTP-only config'
mkdir -p infrastructure/nginx/conf.d-bootstrap infrastructure/nginx/www
cat > infrastructure/nginx/conf.d-bootstrap/bootstrap.conf <<EOF
server {
  listen 80;
  server_name $DOMAIN www.$DOMAIN ${API_DOMAIN:-api.$DOMAIN} ${ADMIN_DOMAIN:-admin.$DOMAIN};
  location /.well-known/acme-challenge/ { root /var/www/certbot; }
  location / { return 200 'RESTOR bootstrap'; add_header Content-Type text/plain; }
}
EOF

docker run -d --name restor-certbot-nginx \
  -p 80:80 \
  -v "$PWD/infrastructure/nginx/conf.d-bootstrap:/etc/nginx/conf.d:ro" \
  -v restor_certbot_webroot:/var/www/certbot \
  nginx:1.27-alpine >/dev/null

cleanup() {
  docker rm -f restor-certbot-nginx >/dev/null 2>&1 || true
  rm -rf infrastructure/nginx/conf.d-bootstrap
}
trap cleanup EXIT

sleep 3

log 'Requesting the certificate'
docker run --rm \
  -v restor_certbot_certs:/etc/letsencrypt \
  -v restor_certbot_webroot:/var/www/certbot \
  certbot/certbot certonly \
    --webroot -w /var/www/certbot \
    --email "$CERTBOT_EMAIL" \
    --agree-tos --no-eff-email \
    --non-interactive \
    "${DOMAIN_ARGS[@]}"

cleanup
trap - EXIT

printf '\033[0;32m✔\033[0m Certificate issued for %s\n' "$DOMAIN"
echo '  Renewal runs automatically via the certbot container.'
echo '  Next: ./infrastructure/deployment/deploy.sh'
