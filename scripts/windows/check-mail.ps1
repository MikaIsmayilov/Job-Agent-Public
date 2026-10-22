# Windows counterpart of scripts/check-mail.sh: move applied jobs to
# interview/rejected from Gmail (GMAIL_ADDRESS / GMAIL_APP_PASSWORD in .env;
# skips quietly without them).
#   powershell -ExecutionPolicy Bypass -File scripts\windows\check-mail.ps1 [-Force]
param([switch]$Force)
. "$PSScriptRoot\common.ps1"
Set-Location $Root
$defer = @("--defer-to-cloud")
if (Test-LocalDashboard) {
  # A local dashboard has no cloud cron to defer to.
  $defer = @()
  Start-JobAgentServer
}
if ($Force) { $defer = @() }
uv run --directory scraper python -m jobagent_scraper.main mail --days 3 @defer
exit $LASTEXITCODE
