#!/bin/bash
# Removes the LaunchAgent installed by install-launchagent.sh. Quireloop
# stops running in the background and no longer starts at login; you're
# back to running it manually (npm start).
set -euo pipefail

LABEL="com.quireloop.server"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"

if [[ ! -f "$PLIST_PATH" ]]; then
  echo "No LaunchAgent installed (nothing to remove)."
  exit 0
fi

launchctl unload "$PLIST_PATH" 2>/dev/null || true
rm -f "$PLIST_PATH"
echo "Removed. Quireloop will no longer start automatically at login."
