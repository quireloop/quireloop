#!/usr/bin/env bash
# Installs LanguageTool, the free open-source grammar checker, as a private
# service on this machine: it listens only on 127.0.0.1 and sends text nowhere.
# Then points Quireloop's systemd service at it. Needs Java 17 or newer and
# about 1.5 GB of memory. Run as root:
#
#   sudo bash scripts/install-languagetool.sh
set -euo pipefail

VERSION=${LANGUAGETOOL_VERSION:-6.6}
DEST=/opt/languagetool
PORT=${LANGUAGETOOL_PORT:-8011}
URL="https://languagetool.org/download/LanguageTool-$VERSION.zip"

[ "$(id -u)" = 0 ] || { echo "Run with sudo." >&2; exit 1; }
command -v java >/dev/null || { echo "Install Java first (default-jre-headless on Ubuntu)." >&2; exit 1; }
command -v unzip >/dev/null || { echo "Install unzip first." >&2; exit 1; }

if [ ! -f "$DEST/languagetool-server.jar" ]; then
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  echo "==> Downloading LanguageTool $VERSION (about 250 MB)"
  curl -fL --proto '=https' -o "$TMP/lt.zip" "$URL"
  unzip -q "$TMP/lt.zip" -d "$TMP"
  rm -rf "$DEST"
  mv "$TMP/LanguageTool-$VERSION" "$DEST"
  chown -R root:root "$DEST"
  chmod -R a+rX "$DEST"
fi

id languagetool >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin languagetool

cat > /etc/systemd/system/languagetool.service <<UNIT
[Unit]
Description=LanguageTool grammar checker (private to this machine)
After=network.target

[Service]
User=languagetool
ExecStart=$(command -v java) -Xmx1g -cp $DEST/languagetool-server.jar org.languagetool.server.HTTPServer --port $PORT
Restart=on-failure
PrivateTmp=true
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT

mkdir -p /etc/systemd/system/quireloop.service.d
cat > /etc/systemd/system/quireloop.service.d/languagetool.conf <<UNIT
[Service]
Environment=QUIRELOOP_LANGUAGETOOL_URL=http://127.0.0.1:$PORT
UNIT

systemctl daemon-reload
systemctl enable --now languagetool
systemctl restart quireloop
echo "Done. Grammar check is in each project's menu. LanguageTool is on 127.0.0.1:$PORT."
