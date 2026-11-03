#!/usr/bin/env bash
# Keeps dated copies of Quireloop's data on another disk, and optionally sends
# the papers off this machine. Runs every 10 minutes from
# deploy/quireloop-backup.timer; run it by hand as root to back up right now.
#
# Settings come from /etc/quireloop/backup.env (see
# deploy/quireloop-backup.env.example), or from the environment:
#   QUIRELOOP_DATA_DIR    the data folder to copy
#   BACKUP_DIR            a folder on a DIFFERENT disk
#   KEEP_RECENT_HOURS     keep every copy this many hours old or newer (default 24)
#   KEEP_DAILY            days to keep the last copy of (default 14)
#   KEEP_MONTHLY          first-of-the-month copies to keep (default 6)
#   RCLONE_REMOTE         optional off-site target, e.g. onedrive-crypt:quireloop
#   ALLOW_SAME_DISK       set to 1 to skip the different-disk check
#   DATA_OWNER            who owns the status file, default the data folder's owner
#
# Each copy is a complete folder. Unchanged files are hard links to the previous
# copy, so a copy costs only what changed. Every run makes a copy, even with
# nothing changed, so a quiet hour still shows the backup is alive.
set -euo pipefail

CONFIG=${QUIRELOOP_BACKUP_CONFIG:-/etc/quireloop/backup.env}
# shellcheck disable=SC1090
[ -r "$CONFIG" ] && . "$CONFIG"

: "${QUIRELOOP_DATA_DIR:?Set QUIRELOOP_DATA_DIR in $CONFIG}"
: "${BACKUP_DIR:?Set BACKUP_DIR in $CONFIG}"
KEEP_RECENT_HOURS=${KEEP_RECENT_HOURS:-24}
KEEP_DAILY=${KEEP_DAILY:-14}
KEEP_MONTHLY=${KEEP_MONTHLY:-6}
DATA=${QUIRELOOP_DATA_DIR%/}
DEST=${BACKUP_DIR%/}

fail() { echo "backup failed: $*" >&2; exit 1; }

# Written for the Linux server: GNU stat, find and date, flock, and bash 4.
[ "$(uname)" = Linux ] || fail "this script runs on the Linux server only; on your own computer, copy the data folder with your usual backup tool"

[ -f "$DATA/users.json" ] || [ -d "$DATA/projects" ] || fail "$DATA does not look like Quireloop data"
# An unmounted disk leaves an empty folder behind, and writing there would fill
# the system disk while looking like success.
[ -d "$DEST" ] || fail "$DEST does not exist. Is the backup disk mounted?"
if [ "${ALLOW_SAME_DISK:-0}" != 1 ] && [ "$(stat -c %d "$DATA")" = "$(stat -c %d "$DEST")" ]; then
  fail "$DEST is on the same disk as the data, so it would not survive that disk failing"
fi

chmod 700 "$DEST"
exec 9>"$DEST/.lock"
flock -n 9 || fail "another backup is still running"

# Copies are named 2026-11-03_0350. Copies from older versions are named by
# day alone, which sorts before any copy made later that day.
STAMP=$(date +%Y-%m-%d_%H%M)
DAY=${STAMP%_*}
WORK="$DEST/.incomplete-$STAMP"
list_copies() { find "$DEST" -maxdepth 1 -type d -name '20??-??-??*' -printf '%f\n' | sort; }
LATEST=$(list_copies | tail -1)

LINK=()
[ -n "$LATEST" ] && LINK=(--link-dest="$DEST/$LATEST")
rm -rf "$WORK"
mkdir -p "$WORK"
chmod 700 "$WORK"
# compile-cache is rebuilt by compiling; everything else is the real thing,
# including users.json, which holds password hashes and API keys. Hence 700.
rsync -a --delete --exclude '/compile-cache/' "${LINK[@]}" "$DATA/" "$WORK/"
chmod 700 "$WORK"

# A project made with "Open a Folder" is a link to where the paper really lives,
# and a backup of the link alone would save nothing. Copy what it points at.
while IFS= read -r link; do
  rel=${link#"$WORK"/}
  target=$(readlink -f "$DATA/$rel") || continue
  [ -d "$target" ] || continue
  rm "$link"
  OLD=()
  [ -n "$LATEST" ] && [ -d "$DEST/$LATEST/$rel" ] && OLD=(--link-dest="$DEST/$LATEST/$rel")
  mkdir "$link"
  rsync -a "${OLD[@]}" "$target/" "$link/"
done < <(find "$WORK/projects" -mindepth 2 -maxdepth 2 -type l 2>/dev/null)

# A second run in the same minute replaces the first.
rm -rf "${DEST:?}/$STAMP"
mv "$WORK" "$DEST/$STAMP"
sync

# Refuse to call it a backup unless the copy really matches.
if diff -rq --exclude=compile-cache "$DATA/projects" "$DEST/$STAMP/projects" >/dev/null 2>&1; then
  VERIFIED=true
else
  # Someone may be typing during the backup, so only a missing project counts.
  VERIFIED=false
  [ "$(find "$DATA/projects" -type f | wc -l)" -le $(( $(find "$DEST/$STAMP/projects" -type f | wc -l) + 50 )) ] \
    || fail "the copy in $DEST/$STAMP is missing files"
fi

# Keep every copy from the last KEEP_RECENT_HOURS, the last copy of each of the
# newest KEEP_DAILY days, and the first copy of each of the newest KEEP_MONTHLY
# months. Names sort by time, so comparing them as text compares their times.
mapfile -t ALL < <(list_copies)
declare -A KEEP=()
CUTOFF=$(date -d "$KEEP_RECENT_HOURS hours ago" +%Y-%m-%d_%H%M)
for copy in "${ALL[@]}"; do
  if [[ ! "$copy" < "$CUTOFF" ]]; then KEEP[$copy]=1; fi
done
for copy in $(printf '%s\n' "${ALL[@]}" | tac | awk '!seen[substr($0,1,10)]++' | head -n "$KEEP_DAILY"); do KEEP[$copy]=1; done
for copy in $(printf '%s\n' "${ALL[@]}" | awk '!seen[substr($0,1,7)]++' | tail -n "$KEEP_MONTHLY"); do KEEP[$copy]=1; done
KEEP[$STAMP]=1
for copy in "${ALL[@]}"; do
  [ -n "${KEEP[$copy]:-}" ] || rm -rf "${DEST:?}/$copy"
done
COUNT=$(list_copies | wc -l)

CLOUD=""
if [ -n "${RCLONE_REMOTE:-}" ]; then
  # Papers only: users.json and session-key must not go to a cloud account.
  # `copy`, not `sync`: a paper wiped here must not vanish there too.
  if rclone copy "$DATA/projects" "$RCLONE_REMOTE/projects" --exclude 'build/**' --exclude '.git/**' \
    --backup-dir "$RCLONE_REMOTE/older/$DAY" --quiet; then
    CLOUD="$RCLONE_REMOTE at $(date -Is)"
  else
    CLOUD="FAILED at $(date -Is)"
  fi
fi

STATUS="$DATA/backup-status.json"
printf '{"lastRun":"%s","snapshots":%s,"verified":%s,"cloud":"%s"}\n' \
  "$(date -Is)" "$COUNT" "$VERIFIED" "$CLOUD" > "$STATUS.tmp"
chown "${DATA_OWNER:-$(stat -c %u:%g "$DATA")}" "$STATUS.tmp" 2>/dev/null || true
mv "$STATUS.tmp" "$STATUS"
echo "Backed up to $DEST/$STAMP ($COUNT copies kept, exact match: $VERIFIED). ${CLOUD:+Off-site: $CLOUD}"
[ "$CLOUD" != "${CLOUD#FAILED}" ] && fail "the off-site copy did not finish"
exit 0
