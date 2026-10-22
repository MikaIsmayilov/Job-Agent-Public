# Installs two Windows Task Scheduler jobs for this checkout (the Windows
# counterpart of scripts/install-schedule.sh):
#   Job Agent Scrape  daily at 09:00   -> scripts\windows\scrape.ps1
#   Job Agent Mail    every 3 hours    -> scripts\windows\check-mail.ps1
# Both run as you, only while you are logged on, and catch up after the PC
# wakes (StartWhenAvailable). Logs: scraper\out\task-{scrape,mail}.log.
#   powershell -ExecutionPolicy Bypass -File scripts\windows\install-schedule.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\windows\install-schedule.ps1 -Uninstall
param([switch]$Uninstall, [string]$ScrapeTime = "09:00")
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Names = @("Job Agent Scrape", "Job Agent Mail")

foreach ($name in $Names) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
}
if ($Uninstall) { Write-Output "Removed the Job Agent scheduled tasks."; exit 0 }

New-Item -ItemType Directory -Force -Path (Join-Path $Root "scraper\out") | Out-Null

function New-JobAgentAction([string]$script, [string]$log) {
  $ps = "& '$Root\scripts\windows\$script' *>> '$Root\scraper\out\$log'"
  New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$ps`"" -WorkingDirectory $Root
}

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3)

$daily = New-ScheduledTaskTrigger -Daily -At $ScrapeTime
Register-ScheduledTask -TaskName "Job Agent Scrape" -Action (New-JobAgentAction "scrape.ps1" "task-scrape.log") -Trigger $daily -Settings $settings -Description "Job Agent: daily job scrape" | Out-Null

$mail = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(30) -RepetitionInterval (New-TimeSpan -Hours 3)
Register-ScheduledTask -TaskName "Job Agent Mail" -Action (New-JobAgentAction "check-mail.ps1" "task-mail.log") -Trigger $mail -Settings $settings -Description "Job Agent: recruiter mail check" | Out-Null

Write-Output "Installed: scrape daily at $ScrapeTime, mail check every 3 hours at :30."
Write-Output "Run one now with: Start-ScheduledTask -TaskName 'Job Agent Scrape'"
