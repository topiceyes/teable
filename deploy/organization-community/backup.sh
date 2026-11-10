#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")"
target=${1:?Usage: bash backup.sh /absolute/path/to/new-backup-directory}
[[ "$target" = /* ]] || { echo 'Backup target must be an absolute path' >&2; exit 1; }
# mkdir without -p refuses to overwrite an earlier backup.
mkdir "$target"
compose=(docker compose --env-file .env.production.local -f compose.yaml)
[[ "$("${compose[@]}" ps --status running --services | sort)" = $'app\ncache\ndb' ]] || {
  echo 'Expected app/cache/db running; backup aborted' >&2; exit 1;
}
resume() { "${compose[@]}" start app >/dev/null; }
trap resume EXIT
# Quiesce this single-node deployment so DB and local attachments form one snapshot.
"${compose[@]}" stop app
"${compose[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$target/database.dump"
"${compose[@]}" run --rm --no-deps -T --entrypoint tar app -C /app/.assets -czf - . > "$target/assets.tar.gz"
cp .env.production.local "$target/config.env"
"${compose[@]}" images > "$target/images.txt"
test -s "$target/database.dump"
test -s "$target/assets.tar.gz"
touch "$target/COMPLETE"
echo "Backup completed: $target (contains secrets; store access restricted and copy off-host)"
