#!/usr/bin/env bash
# Root-owned production deploy entrypoint. The restricted SSH command invokes
# this script only after validating that its single argument is a commit SHA.

set -Eeuo pipefail
umask 077

readonly REPO_ROOT=/opt/restor
readonly RELEASES_ROOT=/opt/restor-releases
readonly DEPLOYED_SHA_FILE="$REPO_ROOT/.deployed-sha"
readonly LOCK_FILE=/var/lock/restor-deploy.lock
readonly SHA="${1:-}"

log()  { printf '[restor-ci] %s\n' "$1"; }
fail() { printf '[restor-ci] ERROR: %s\n' "$1" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || fail 'must run as root'
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'expected one full lowercase commit SHA'
[[ -d "$REPO_ROOT/.git" ]] || fail "$REPO_ROOT is not a Git worktree"
[[ -f "$REPO_ROOT/.env.server" ]] || fail 'root .env.server is missing'
[[ -f "$REPO_ROOT/backend/.env.server" ]] || fail 'backend .env.server is missing'
[[ -d "$REPO_ROOT/storage" ]] || fail 'storage directory is missing'

exec 9>"$LOCK_FILE"
flock -n 9 || fail 'another RESTOR deploy is already running'

cd "$REPO_ROOT"
log 'Fetching the current main branch'
git fetch --quiet origin '+refs/heads/main:refs/remotes/origin/main'

readonly MAIN_SHA="$(git rev-parse refs/remotes/origin/main)"
[[ "$SHA" == "$MAIN_SHA" ]] || fail 'requested SHA is not the current origin/main commit'
git cat-file -e "$SHA^{commit}" || fail 'requested commit is unavailable'

readonly RELEASE_DIR="$RELEASES_ROOT/$SHA"
mkdir -p "$RELEASES_ROOT"

if [[ -e "$RELEASE_DIR" ]]; then
  [[ -d "$RELEASE_DIR/.git" || -f "$RELEASE_DIR/.git" ]] \
    || fail "existing release path is not a Git worktree: $RELEASE_DIR"
  [[ "$(git -C "$RELEASE_DIR" rev-parse HEAD)" == "$SHA" ]] \
    || fail 'existing release path points to another commit'
  log 'Reusing the existing release worktree'
else
  log 'Creating an isolated release worktree'
  git worktree add --quiet --detach "$RELEASE_DIR" "$SHA"
fi

# Runtime state stays in the original /opt/restor directory and is never
# copied into GitHub or a release checkout.
ln -sfn "$REPO_ROOT/.env.server" "$RELEASE_DIR/.env.server"
ln -sfn "$REPO_ROOT/backend/.env.server" "$RELEASE_DIR/backend/.env.server"
ln -sfn "$REPO_ROOT/storage" "$RELEASE_DIR/storage"

set -a
# shellcheck disable=SC1091
. "$REPO_ROOT/.env.server"
set +a

readonly BACKUP_DIR="$REPO_ROOT/infrastructure/database/backups"
readonly BACKUP_STAMP="$(date -u +%Y%m%d-%H%M%S)"
readonly BACKUP_FINAL="$BACKUP_DIR/pre-ci-$BACKUP_STAMP-$SHA.sql.gz"
readonly BACKUP_TMP="$BACKUP_FINAL.tmp"
readonly COMPOSE_FILE="$REPO_ROOT/docker-compose.server.yml"

mkdir -p "$BACKUP_DIR"
log 'Creating a PostgreSQL backup before deployment'
if docker compose -f "$COMPOSE_FILE" --env-file "$REPO_ROOT/.env.server" \
    exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    | gzip > "$BACKUP_TMP"; then
  mv "$BACKUP_TMP" "$BACKUP_FINAL"
else
  rm -f "$BACKUP_TMP"
  fail 'database backup failed; deployment was not started'
fi

log "Deploying $SHA"
cd "$RELEASE_DIR"
bash infrastructure/deployment/deploy-shared-host.sh

readonly MARKER_TMP="$DEPLOYED_SHA_FILE.tmp"
printf '%s\n' "$SHA" > "$MARKER_TMP"
mv "$MARKER_TMP" "$DEPLOYED_SHA_FILE"
log "Deployment complete: $SHA"
