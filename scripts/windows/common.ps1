# Shared helpers for the Windows scripts. Dot-source it: . "$PSScriptRoot\common.ps1"
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$OutDir = Join-Path $Root "scraper\out"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# Load KEY=VALUE lines from .env into this process (never printed).
$EnvFile = Join-Path $Root ".env"
if (Test-Path $EnvFile) {
  Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
      [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim('"').Trim("'"), "Process")
    }
  }
}

function Test-LocalDashboard {
  $config = Get-Content (Join-Path $Root "scraper\config.yml") -Raw
  return $config -match '(?m)^\s*base_url:\s*http://(localhost|127\.0\.0\.1)'
}

function Test-ServerHealthy {
  try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000/api/jobs" -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

# Ensure exactly one healthy dev server on :3000 (see scripts/ensure-server.sh).
function Start-JobAgentServer {
  if (Test-ServerHealthy) { return }
  Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -match 'vinext[\\/]dist[\\/]cli\.js|workerd' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
  $log = Join-Path $OutDir "dev-server.log"
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c pnpm dev >> `"$log`" 2>&1" -WorkingDirectory $Root -WindowStyle Hidden
  for ($i = 0; $i -lt 60; $i++) {
    if (Test-ServerHealthy) { return }
    Start-Sleep -Seconds 2
  }
  throw "dev server failed to become ready on :3000 (see $log)"
}

# Snapshot the local D1 database, keeping the 7 newest (see scripts/backup-db.sh).
function Backup-JobAgentDb {
  $db = Get-ChildItem (Join-Path $Root ".wrangler\state\v3\d1\miniflare-D1DatabaseObject") -Filter *.sqlite -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $db) { Write-Output "[backup] no D1 database found, skipping"; return }
  $dest = Join-Path $Root "outputs\backups"
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  $snap = Join-Path $dest ("jobs-" + (Get-Date -Format "yyyyMMdd") + ".sqlite")
  $script = "const { DatabaseSync, backup } = require('node:sqlite'); const src = new DatabaseSync(process.argv[1], { readOnly: true }); backup(src, process.argv[2]).then(() => src.close(), (e) => { src.close(); console.error(e); process.exit(1); });"
  node -e $script $db.FullName $snap
  Get-ChildItem $dest -Filter "jobs-*.sqlite" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 7 | Remove-Item -Force
  Write-Output "[backup] snapshot $(Split-Path $snap -Leaf)"
}
