#!/bin/bash
# Installs Quireloop as a macOS LaunchAgent: starts automatically at login,
# stays running in the background, restarts itself if it ever crashes. Once
# installed, working in Quireloop is "open the bookmark" — no terminal, no
# remembering to start a server first.
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This installer is for macOS (launchd). On Linux, use a systemd --user service instead." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$REPO_ROOT/server"
NODE_BIN="$(command -v node || true)"
LABEL="com.quireloop.server"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/Quireloop"
PORT="${PORT:-4173}"

if [[ -z "$NODE_BIN" ]]; then
  echo "Couldn't find 'node' on your PATH. Install Node.js first, then re-run this." >&2
  exit 1
fi

if [[ ! -d "$SERVER_DIR/node_modules" ]]; then
  echo "Dependencies aren't installed yet — run 'npm install' from the repo root first." >&2
  exit 1
fi

if [[ ! -d "$REPO_ROOT/server/public" ]]; then
  echo "No production build found yet — run 'npm run build --workspace=web' first," >&2
  echo "(or just 'cd web && npm run build')." >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

# The PATH captured here is the *installing shell's* PATH — launchd itself
# runs services with a minimal PATH that won't include Homebrew, TeX Live,
# or nvm locations, which would otherwise break latexmk/git/unzip lookups.
cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$SERVER_DIR/src/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$SERVER_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$PATH</string>
        <key>PORT</key>
        <string>$PORT</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/server.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/server.error.log</string>
</dict>
</plist>
PLIST

launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load -w "$PLIST_PATH"

sleep 1
if curl -sf "http://localhost:$PORT/api/projects" >/dev/null 2>&1; then
  echo "Quireloop is running in the background and will start automatically at login."
  echo "Open http://localhost:$PORT"
else
  echo "Installed, but the server didn't respond yet. If something else is already"
  echo "using port $PORT (e.g. a manually-started 'npm start'), stop that first, then:"
  echo "  launchctl kickstart -k gui/\$(id -u)/$LABEL"
  echo "Logs: $LOG_DIR/server.log and $LOG_DIR/server.error.log"
fi

echo
echo "To remove this and go back to running it manually: npm run service:uninstall"
