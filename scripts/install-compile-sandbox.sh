#!/usr/bin/env bash
# Installs bubblewrap, which Quireloop uses to isolate LaTeX compiles, and on
# Ubuntu the AppArmor profile it needs to start. Safe to run more than once.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo." >&2
  exit 1
fi

repo="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v bwrap >/dev/null; then
  apt-get update
  # A failure here can belong to some other half-installed package, because
  # apt finishes those first. What matters is whether bwrap arrived.
  apt-get install -y bubblewrap || command -v bwrap >/dev/null
fi

check() {
  sudo -u nobody bwrap --ro-bind / / --unshare-net --unshare-pid true 2>/dev/null
}

if ! check && [ -f /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then
  install -o root -g root -m 0644 "$repo/deploy/quireloop-bwrap.apparmor" /etc/apparmor.d/quireloop-bwrap
  apparmor_parser -r /etc/apparmor.d/quireloop-bwrap
fi

if check; then
  echo "Compile sandbox is ready."
else
  echo "bubblewrap is installed but still cannot start." >&2
  exit 1
fi
