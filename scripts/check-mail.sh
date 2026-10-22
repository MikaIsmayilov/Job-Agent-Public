#!/usr/bin/env bash
# Recruiter-reply check: conservatively moves applied -> interview/rejected
# from Gmail (IMAP, GMAIL_* in .env) and sends replies it cannot tie to one
# application to the dashboard's "replies need you" card. Scheduled every few
# hours via launchd (scripts/install-schedule.sh).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if [[ -f "$ROOT/.env" ]]; then
  set -a; source "$ROOT/.env"; set +a
fi
cd "$ROOT"
# With a cloud dashboard its cron (worker/mail.ts) normally does this; the
# scheduled run stands down while it is reporting and takes over when it
# stops. A local dashboard has no cron, so this always checks (and starts the
# server). `pnpm mail` sets JOBAGENT_MAIL_FORCE=1 to always check.
DEFER=(--defer-to-cloud)
if grep -Eq '^\s*base_url:\s*http://(localhost|127\.0\.0\.1)' scraper/config.yml; then
  DEFER=()
  "$SCRIPT_DIR/ensure-server.sh"
fi
[[ "${JOBAGENT_MAIL_FORCE:-}" == "1" ]] && DEFER=()
uv run --directory scraper python -m jobagent_scraper.main mail --days 3 ${DEFER[@]+"${DEFER[@]}"}
