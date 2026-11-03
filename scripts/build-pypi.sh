#!/usr/bin/env bash
# Builds the PyPI package (`pip install quireloop`) into packaging/pypi/dist.
# The wheel carries the built web app, the server and its production modules;
# Node.js itself comes from the nodejs-wheel-binaries dependency.
#
# Needs Node.js 22+, npm and Python 3.9+ with venv. Run from anywhere:
#   bash scripts/build-pypi.sh
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
PKG="$REPO/packaging/pypi"
APP="$PKG/src/quireloop/app"

NODE_VERSION=$(node -p 'require(process.argv[1]).version' "$REPO/server/package.json")
PY_VERSION=$(sed -n 's/^__version__ = "\(.*\)"/\1/p' "$PKG/src/quireloop/__init__.py")
[ "$NODE_VERSION" = "$PY_VERSION" ] || {
  echo "Version mismatch: server/package.json says $NODE_VERSION, packaging/pypi says $PY_VERSION" >&2
  exit 1
}

echo "==> Staging the app"
rm -rf "$APP" "$PKG/dist" "$PKG/build"
mkdir -p "$APP/server"
cp "$REPO/package.json" "$REPO/package-lock.json" "$APP/"
cp "$REPO/server/package.json" "$APP/server/"
cp -R "$REPO/server/src" "$APP/server/src"
# npm checks every workspace listed in package.json, so web needs its manifest.
mkdir -p "$APP/web"
cp "$REPO/web/package.json" "$APP/web/"

echo "==> Building the web app"
# Into the staging folder, at the root path: a pip install is served at /,
# and building in place would overwrite server/public for a subpath deploy.
(cd "$REPO" && VITE_BASE_PATH=/ npm run build --workspace=web -- --outDir "$APP/server/public" --emptyOutDir)

echo "==> Installing the server's production modules"
(cd "$APP" && npm ci --omit=dev --workspace=quireloop-server --include-workspace-root=false --ignore-scripts --no-audit --no-fund)
# Workspace links and manifests that only npm needed.
rm -rf "$APP/web" "$APP/node_modules/quireloop-server" "$APP/node_modules/quireloop-web" "$APP/node_modules/.package-lock.json"
# Quireloop runs on Linux, macOS and Windows, so native-module builds for
# other systems (Android, iOS) are dead weight.
find "$APP/node_modules" -type d -path '*/prebuilds/*' -prune ! -name 'linux-*' ! -name 'darwin-*' ! -name 'win32-*' -exec rm -rf {} +

cp "$REPO/LICENSE" "$PKG/LICENSE"
cp "$REPO/LICENSE" "$APP/LICENSE"

echo "==> Building the wheel"
VENV=$(mktemp -d)
trap 'rm -rf "$VENV"' EXIT
python3 -m venv "$VENV"
"$VENV/bin/pip" install --quiet build
(cd "$PKG" && "$VENV/bin/python" -m build --wheel --outdir dist)
ls -lh "$PKG/dist"
