#!/usr/bin/env bash
# Installs two macOS launchd jobs for this checkout:
#   com.jobagent.scrape  daily at 09:00     -> scripts/scrape.sh
#   com.jobagent.mail    every 3 hours      -> scripts/check-mail.sh
# launchd runs a calendar job missed while the Mac slept as soon as it wakes.
# Logs: scraper/out/launchd-{scrape,mail}.log. Remove with --uninstall.
#
# macOS blocks background jobs from ~/Desktop, ~/Documents and ~/Downloads, and
# a bare /bin/bash can never be granted just one of those folders. So each job
# runs through a tiny app in ~/Applications/Job Agent/; the first time it runs,
# macOS asks "would like to access files in your Desktop folder" and Allow
# grants that app the Desktop only. Rebuilding the apps asks again.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
AGENTS="$HOME/Library/LaunchAgents"
APPS="$HOME/Applications/Job Agent"
UID_NUM="$(id -u)"

unload() { launchctl bootout "gui/$UID_NUM/$1" 2>/dev/null || true; rm -f "$AGENTS/$1.plist"; }

if [[ "${1:-}" == "--uninstall" ]]; then
  unload com.jobagent.scrape; unload com.jobagent.mail
  rm -rf "$APPS"
  echo "Removed the job-agent launchd jobs and runner apps."; exit 0
fi

mkdir -p "$AGENTS" "$ROOT/scraper/out" "$APPS"

build_app() { # name script log -> prints the app's executable path
  local app="$APPS/$1.app"
  rm -rf "$app"
  osacompile -o "$app" -e "do shell script \"/bin/bash '$ROOT/scripts/$2' >> '$ROOT/scraper/out/$3' 2>&1\"" >/dev/null
  # Background-only: no Dock icon while it runs.
  /usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$app/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.jobagent.runner.$2" "$app/Contents/Info.plist" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.jobagent.runner.$2" "$app/Contents/Info.plist"
  codesign --force --deep -s - "$app" >/dev/null 2>&1
  echo "$app/Contents/MacOS/applet"
}

write_plist() { # label executable log calendar-xml
  cat > "$AGENTS/$1.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$1</string>
  <key>ProgramArguments</key><array><string>$2</string></array>
  <key>StartCalendarInterval</key>$4
  <key>StandardOutPath</key><string>$ROOT/scraper/out/$3</string>
  <key>StandardErrorPath</key><string>$ROOT/scraper/out/$3</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
PLIST
  unload_only "$1"
  launchctl bootstrap "gui/$UID_NUM" "$AGENTS/$1.plist"
}
unload_only() { launchctl bootout "gui/$UID_NUM/$1" 2>/dev/null || true; }

write_plist com.jobagent.scrape "$(build_app "Job Agent Scrape" scrape.sh launchd-scrape.log)" launchd-scrape.log '<dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>'
MAIL_TIMES="<array>"
for hour in 0 3 6 9 12 15 18 21; do MAIL_TIMES+="<dict><key>Hour</key><integer>$hour</integer><key>Minute</key><integer>30</integer></dict>"; done
MAIL_TIMES+="</array>"
write_plist com.jobagent.mail "$(build_app "Job Agent Mail" check-mail.sh launchd-mail.log)" launchd-mail.log "$MAIL_TIMES"

echo "Installed: scrape daily at 09:00, mail check every 3 hours at :30."
echo "Run one now with: launchctl kickstart gui/$UID_NUM/com.jobagent.mail"
echo "The first run of each asks for Desktop access: click Allow."
