#!/usr/bin/env bash
# Daily scrape: run every source and ingest into the dashboard named by
# server.base_url in scraper/config.yml, which then shows "Last scrape". Run manually with
# `pnpm scrape`, or on schedule via launchd (scripts/install-schedule.sh).
# Recruiter mail is checked separately by scripts/check-mail.sh.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if [[ -f "$ROOT/.env" ]]; then
  set -a; source "$ROOT/.env"; set +a
fi
cd "$ROOT"

# Local dashboard (the default): make sure it is running and snapshot its
# database first. A cloud dashboard needs neither.
if grep -Eq '^\s*base_url:\s*http://(localhost|127\.0\.0\.1)' scraper/config.yml; then
  "$SCRIPT_DIR/ensure-server.sh"
  "$SCRIPT_DIR/backup-db.sh"
fi
uv run --directory scraper python -m jobagent_scraper.main scrape --source all "$@"
