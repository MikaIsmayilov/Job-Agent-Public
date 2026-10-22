#!/usr/bin/env bash
# Replaces the local dev database with a copy of the cloud D1 database (the
# system of record), so `pnpm dev` on http://localhost:3000 shows current data.
# This is the fallback if Workers Paid lapses: pull once, then work locally.
# The previous local file is kept in .wrangler/backups/.
#
#   bash scripts/pull-cloud-db.sh           # pull and replace (stop pnpm dev first)
#   bash scripts/pull-cloud-db.sh --check   # export and build the copy, change nothing
#
# One way only: local edits are never pushed back to the cloud.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
CHECK=0
[[ "${1:-}" == "--check" ]] && CHECK=1

DIR=.wrangler/state/v3/d1/miniflare-D1DatabaseObject
LOCAL_DB="$(find "$DIR" -maxdepth 1 -name '*.sqlite' ! -name metadata.sqlite 2>/dev/null | head -n 2)"
if [[ -z "$LOCAL_DB" ]]; then
  echo "No local database yet: run pnpm dev once, stop it, then rerun this." >&2; exit 1
fi
if [[ "$(printf '%s\n' "$LOCAL_DB" | wc -l)" -gt 1 ]]; then
  echo "More than one local D1 file in $DIR; remove the stale one first:" >&2; printf '%s\n' "$LOCAL_DB" >&2; exit 1
fi
if [[ $CHECK == 0 ]] && lsof -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Stop pnpm dev first (port 3000 is in use); the database file must not be open." >&2; exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# wrangler needs a config naming the database; take it from the deploy settings.
python3 - "$TMP/wrangler.json" <<'PY'
import json, sys
src = json.load(open("deploy.cloudflare.json"))
json.dump({k: src[k] for k in ("name", "account_id", "d1_databases")}, open(sys.argv[1], "w"))
PY
DB_NAME="$(python3 -c 'import json; print(json.load(open("deploy.cloudflare.json"))["d1_databases"][0]["database_name"])')"

echo "Exporting $DB_NAME from Cloudflare..."
pnpm exec wrangler d1 export "$DB_NAME" --remote --config "$TMP/wrangler.json" --output "$TMP/cloud.sql" >/dev/null
sqlite3 "$TMP/new.sqlite" < "$TMP/cloud.sql"

# Miniflare keeps its own bookkeeping row in each local D1 file; carry it over.
sqlite3 "$LOCAL_DB" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null
sqlite3 "$TMP/new.sqlite" "ATTACH '$LOCAL_DB' AS old; CREATE TABLE IF NOT EXISTS _cf_METADATA (key INTEGER PRIMARY KEY, value BLOB); INSERT OR REPLACE INTO _cf_METADATA SELECT * FROM old._cf_METADATA;"
sqlite3 "$TMP/new.sqlite" "PRAGMA integrity_check;" | grep -qx ok || { echo "The exported copy failed an integrity check; local database left unchanged." >&2; exit 1; }

counts() { sqlite3 "$1" "SELECT (SELECT COUNT(*) FROM jobs) || ' jobs, newest update ' || COALESCE((SELECT MAX(updated_at) FROM jobs), 'none');"; }
echo "Cloud copy: $(counts "$TMP/new.sqlite")"
echo "Local now:  $(counts "$LOCAL_DB")"
if [[ $CHECK == 1 ]]; then echo "Check only: nothing replaced."; exit 0; fi

mkdir -p .wrangler/backups
BACKUP=".wrangler/backups/local-$(date +%Y%m%d-%H%M%S).sqlite"
cp "$LOCAL_DB" "$BACKUP"
mv "$TMP/new.sqlite" "$LOCAL_DB"
rm -f "$LOCAL_DB-wal" "$LOCAL_DB-shm"
echo "Local database replaced with the cloud copy. Previous local file: $BACKUP"
