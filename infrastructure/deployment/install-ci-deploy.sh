#!/usr/bin/env bash
# One-time installation for the restricted GitHub Actions deploy identity.
# Usage: sudo bash install-ci-deploy.sh /path/to/github-actions.pub

set -Eeuo pipefail
umask 077

readonly DEPLOY_USER=restor-deploy
readonly PUBLIC_KEY_FILE="${1:-}"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() { printf '[restor-ci-setup] ERROR: %s\n' "$1" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || fail 'must run as root'
[[ -f "$PUBLIC_KEY_FILE" ]] || fail 'pass the dedicated public-key file'

IFS= read -r public_key < "$PUBLIC_KEY_FILE"
[[ "$public_key" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+([[:space:]].*)?$ ]] \
  || fail 'the public key must be a single ssh-ed25519 key'
[[ "$(wc -l < "$PUBLIC_KEY_FILE")" -le 1 ]] || fail 'the public-key file has extra lines'

if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
  passwd --lock "$DEPLOY_USER" >/dev/null
fi

install -o root -g root -m 0755 \
  "$SCRIPT_DIR/deploy-from-ci.sh" /usr/local/sbin/restor-deploy
install -o root -g root -m 0755 \
  "$SCRIPT_DIR/ci-ssh-entrypoint.sh" /usr/local/sbin/restor-ci-entrypoint

readonly SSH_DIR="/home/$DEPLOY_USER/.ssh"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0700 "$SSH_DIR"
printf 'restrict,command="/usr/local/sbin/restor-ci-entrypoint" %s\n' "$public_key" \
  > "$SSH_DIR/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "$SSH_DIR/authorized_keys"
chmod 0600 "$SSH_DIR/authorized_keys"

readonly SUDOERS_TMP="$(mktemp)"
trap 'rm -f "$SUDOERS_TMP"' EXIT
printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/restor-deploy *\n' "$DEPLOY_USER" \
  > "$SUDOERS_TMP"
visudo -cf "$SUDOERS_TMP" >/dev/null
install -o root -g root -m 0440 "$SUDOERS_TMP" /etc/sudoers.d/restor-ci-deploy

printf '[restor-ci-setup] Restricted deploy identity installed.\n'
