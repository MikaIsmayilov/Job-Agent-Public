#!/usr/bin/env bash
# Copies GMAIL_ADDRESS and GMAIL_APP_PASSWORD from .env into Worker secrets so
# the cloud mail cron (worker/mail.ts) logs into the same mailbox as the local
# check. Values go straight from .env to wrangler on stdin; nothing is printed.
# Rerun after changing the app password.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
set -a; source .env; set +a
for name in GMAIL_ADDRESS GMAIL_APP_PASSWORD; do
  if [[ -z "${!name:-}" ]]; then echo "$name is missing from .env" >&2; exit 1; fi
  printf '%s' "${!name}" | pnpm exec wrangler secret put "$name" --name job-agent >/dev/null
  echo "Set Worker secret $name."
done
