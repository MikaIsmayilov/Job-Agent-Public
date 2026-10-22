#!/usr/bin/env bash
# Validate the build; source settings live in deploy.cloudflare.json.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import json
from pathlib import Path
source = json.loads(Path('deploy.cloudflare.json').read_text())
built = json.loads(Path('dist/server/wrangler.json').read_text())
for key in ('name', 'account_id', 'workers_dev', 'preview_urls', 'd1_databases', 'vars', 'triggers'):
    assert built.get(key) == source[key], f'Build config differs: {key}. Run pnpm build.'
assert 'INGEST_TOKEN' not in built.get('vars', {}), 'Token must be a Worker secret'
assert built['vars']['REQUIRE_ACCESS'] == 'true', 'Production must require Access'
print('Deployment config verified; token is not embedded.')
PY
