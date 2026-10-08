#!/usr/bin/env bash
# =============================================================================
# RESTOR — issue the certificate for restor.uz and its sub-domains, using the
# HOST's certbot and the HOST's nginx.
#
#   sudo ./infrastructure/deployment/init-ssl-host.sh
#
# Run ONCE, after the DNS records point at this server and BEFORE the first
# sub-domain deploy. deploy-shared-host.sh installs an nginx config that
# references /etc/letsencrypt/live/restor.uz/, so without this the config fails
# `nginx -t` and the deploy refuses to continue — deliberately, rather than
# reloading a broken config onto a server that hosts other sites.
#
# This is the shared-host counterpart of init-ssl.sh, which issues the
# certificate inside the Docker stack instead. Use one or the other, not both.
#
# Renewal afterwards is handled by the host's existing certbot timer.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# One certificate for every name. `--cert-name` pins the live directory to
# `restor.uz` so the nginx snippet keeps working when a name is added later —
# without it, certbot would create `restor.uz-0001` on the next run and nginx
# would quietly go on serving the old certificate.
CERT_NAME='restor.uz'
CERT_DOMAINS=(
  restor.uz
  www.restor.uz
  api.restor.uz
  app.restor.uz
  pos.restor.uz
  kds.restor.uz
  tg.restor.uz
  # courier.restor.uz — add when the courier host is turned on (see restor.conf)
)

ACME_WEBROOT='/var/www/html'
BOOTSTRAP_SITE='/etc/nginx/sites-available/restor-bootstrap'
BOOTSTRAP_LINK='/etc/nginx/sites-enabled/restor-bootstrap'

log()  { printf '\033[0;34m▸\033[0m %s\n' "$1"; }
ok()   { printf '\033[0;32m✔\033[0m %s\n' "$1"; }
fail() { printf '\033[0;31m✖\033[0m %s\n' "$1" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || fail 'Run with sudo — this writes to /etc/nginx and /etc/letsencrypt'
command -v certbot >/dev/null || fail 'certbot is not installed (apt install certbot)'
command -v nginx   >/dev/null || fail 'nginx is not installed'

CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
if [[ -z "$CERTBOT_EMAIL" && -f .env.server ]]; then
  # shellcheck disable=SC1091
  CERTBOT_EMAIL="$(grep -E '^CERTBOT_EMAIL=' .env.server | cut -d= -f2- | tr -d '"' || true)"
fi
[[ -n "$CERTBOT_EMAIL" ]] || fail 'Set CERTBOT_EMAIL in .env.server (or in the environment) — it is where expiry warnings go'

# --- DNS ---------------------------------------------------------------------
# Let's Encrypt validates over HTTP from the outside. A name that does not
# resolve here fails the whole request, including the names that would have
# worked, so check every one first.
log 'Checking DNS'
SERVER_IP="$(curl -fsS https://api.ipify.org || echo '')"
[[ -n "$SERVER_IP" ]] || log '  could not determine this server’s public IP — skipping the comparison'

MISMATCHED=()
for domain in "${CERT_DOMAINS[@]}"; do
  resolved="$(getent hosts "$domain" | awk '{print $1}' | head -n1 || echo '')"
  if [[ -z "$resolved" ]]; then
    MISMATCHED+=("$domain → does not resolve")
  elif [[ -n "$SERVER_IP" && "$resolved" != "$SERVER_IP" ]]; then
    MISMATCHED+=("$domain → $resolved (expected $SERVER_IP)")
  fi
done

if [[ ${#MISMATCHED[@]} -gt 0 ]]; then
  printf '  ⚠ %s\n' "${MISMATCHED[@]}" >&2
  echo "    Let's Encrypt will fail for these until DNS propagates." >&2
  read -r -p '  Continue anyway? [y/N] ' answer
  [[ "$answer" == [yY] ]] || exit 1
else
  ok "All ${#CERT_DOMAINS[@]} names resolve to $SERVER_IP"
fi

# --- A port-80 vhost for the challenge ---------------------------------------
# The new names have no server block yet, so a request for
# http://api.restor.uz/.well-known/… would land on whichever site owns port 80
# by default on this shared server. This temporary block claims the names for
# the duration of the request and nothing else.
log 'Installing a temporary HTTP vhost for the ACME challenge'
mkdir -p "$ACME_WEBROOT"

cat > "$BOOTSTRAP_SITE" <<EOF
# Temporary — written by init-ssl-host.sh, removed when it finishes.
server {
    listen 80;
    listen [::]:80;
    server_name ${CERT_DOMAINS[*]};

    location /.well-known/acme-challenge/ {
        root $ACME_WEBROOT;
    }

    location / {
        default_type text/plain;
        return 200 'RESTOR: certificate bootstrap';
    }
}
EOF

ln -sfn "$BOOTSTRAP_SITE" "$BOOTSTRAP_LINK"

cleanup() {
  rm -f "$BOOTSTRAP_LINK" "$BOOTSTRAP_SITE"
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
}
trap cleanup EXIT

# Validate before reloading: a broken config here would take down every site on
# this server, not just RESTOR.
if ! nginx -t; then
  fail 'nginx rejected the temporary vhost — nothing was reloaded'
fi
systemctl reload nginx
ok 'Temporary vhost is live'

# --- Certificate -------------------------------------------------------------
log "Requesting one certificate for ${#CERT_DOMAINS[@]} names"

DOMAIN_ARGS=()
for domain in "${CERT_DOMAINS[@]}"; do DOMAIN_ARGS+=(-d "$domain"); done

certbot certonly \
  --webroot -w "$ACME_WEBROOT" \
  --cert-name "$CERT_NAME" \
  --email "$CERTBOT_EMAIL" \
  --agree-tos --no-eff-email \
  --non-interactive \
  --keep-until-expiring \
  --expand \
  --deploy-hook 'systemctl reload nginx' \
  "${DOMAIN_ARGS[@]}"

cleanup
trap - EXIT

ok "Certificate issued: /etc/letsencrypt/live/$CERT_NAME/"
echo '  Renewal runs from the host certbot timer; the deploy hook reloads nginx.'
echo '  Next: ./infrastructure/deployment/deploy-shared-host.sh'
