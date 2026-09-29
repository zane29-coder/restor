#!/usr/bin/env bash
# =============================================================================
# RESTOR — database backup.
#
#   ./infrastructure/deployment/backup.sh
#
# Add to the deploy user's crontab for a nightly run at 03:00:
#   0 3 * * * cd /home/restor/restor && ./infrastructure/deployment/backup.sh
#
# A backup that has never been restored is a hope, not a backup — see the
# restore command at the bottom and test it on a staging database.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# shellcheck disable=SC1091
set -a; source .env.prod; set +a

BACKUP_DIR="infrastructure/database/backups"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="restor-${STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"

echo "▸ Dumping ${POSTGRES_DB}"
# `--clean --if-exists` makes the dump restorable over an existing database.
$COMPOSE exec -T postgres pg_dump \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --clean --if-exists --no-owner --no-privileges \
  | gzip -9 > "$BACKUP_DIR/$FILE"

SIZE="$(du -h "$BACKUP_DIR/$FILE" | cut -f1)"

# A dump that gzip cannot read is worse than no dump, because it looks fine in
# a directory listing. Verify before reporting success.
if ! gzip -t "$BACKUP_DIR/$FILE"; then
  echo "✖ Backup is corrupt: $FILE" >&2
  rm -f "$BACKUP_DIR/$FILE"
  exit 1
fi

echo "✔ $FILE ($SIZE)"

echo "▸ Removing backups older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -name 'restor-*.sql.gz' -mtime "+$RETENTION_DAYS" -delete

# Off-site copy. A backup on the same disk as the database survives a bad
# migration but not a dead server.
if [[ -n "${BACKUP_S3_BUCKET:-}" ]] && command -v aws >/dev/null; then
  echo "▸ Uploading to s3://${BACKUP_S3_BUCKET}"
  aws s3 cp "$BACKUP_DIR/$FILE" "s3://${BACKUP_S3_BUCKET}/postgres/$FILE"
fi

cat <<EOF

To restore (DESTRUCTIVE — overwrites the target database):
  gunzip -c $BACKUP_DIR/$FILE | \\
    docker compose -f docker-compose.prod.yml --env-file .env.prod \\
      exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB
EOF
