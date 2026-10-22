#!/usr/bin/env bash
# Nightly snapshot of the D1 sqlite (jobs + documents + application history).
# Uses SQLite's online backup API (via Node's built-in node:sqlite) — read-only
# on the source, never writes to the live DB. Keeps the last 7 daily snapshots
# in outputs/backups (gitignored).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

DB=$(ls "$ROOT/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/"*.sqlite 2>/dev/null | head -1)
if [[ -z "${DB:-}" ]]; then
  echo "[backup] no D1 database found — skipping"
  exit 0
fi

DEST="$ROOT/outputs/backups"
mkdir -p "$DEST"
SNAP="$DEST/jobs-$(date +%Y%m%d).sqlite"
node -e "
const { DatabaseSync, backup } = require('node:sqlite');
const src = new DatabaseSync(process.argv[1], { readOnly: true });
backup(src, process.argv[2]).then(
  () => { src.close(); },
  (err) => { src.close(); console.error(err); process.exit(1); }
);
" "$DB" "$SNAP"

# Rotate: keep the 7 newest snapshots.
ls -t "$DEST"/jobs-*.sqlite 2>/dev/null | tail -n +8 | while read -r old; do rm -f "$old"; done

COUNT=$(ls "$DEST"/jobs-*.sqlite 2>/dev/null | wc -l | tr -d ' ')
SIZE=$(du -h "$SNAP" | cut -f1)
echo "[backup] snapshot $(basename "$SNAP") ($SIZE) — $COUNT snapshot(s) retained"
