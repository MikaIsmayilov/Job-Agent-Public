#!/usr/bin/env bash
# Ensure exactly ONE healthy Job Agent dev server on :3000.
# A server that responds but 500s counts as unhealthy: stale/duplicate
# instances are killed before starting fresh (multiple miniflare instances
# sharing .wrangler/state corrupt the D1 runner).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
export PATH="$HOME/.local/bin:$PATH"

healthy() { curl -sf -o /dev/null --max-time 3 http://localhost:3000/api/jobs; }

if healthy; then
  exit 0
fi

# Unhealthy or absent: clear every straggler (the process is
# "node .../vinext/dist/cli.js dev" — matching "vinext dev" catches nothing).
pkill -f "vinext/dist/cli.js" 2>/dev/null || true
pkill -f "bin/workerd" 2>/dev/null || true
sleep 2

cd "$ROOT"
mkdir -p scraper/out
nohup pnpm dev >> "$ROOT/scraper/out/dev-server.log" 2>&1 &
for _ in {1..60}; do
  if healthy; then
    exit 0
  fi
  sleep 2
done
echo "dev server failed to become ready on :3000" >&2
exit 1
