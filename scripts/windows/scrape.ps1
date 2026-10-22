# Windows counterpart of scripts/scrape.sh: run every source and ingest into
# the dashboard named by server.base_url in scraper/config.yml.
#   powershell -ExecutionPolicy Bypass -File scripts\windows\scrape.ps1
. "$PSScriptRoot\common.ps1"
Set-Location $Root
if (Test-LocalDashboard) {
  Start-JobAgentServer
  Backup-JobAgentDb
}
uv run --directory scraper python -m jobagent_scraper.main scrape --source all @args
exit $LASTEXITCODE
