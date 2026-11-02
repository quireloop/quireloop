# Quireloop Roadmap

Quireloop's goal: labs and research groups self-host their own LaTeX
workspace on hardware they already own, instead of renting per-seat
subscriptions. Track changes, full history and unlimited collaborators
are simply included.

Already shipped: accounts + TOTP 2FA, per-user storage, project sharing,
real-time collaborative editing (Yjs CRDT) with attribution, compile
(latexmk) + SyncTeX, version history with restore, per-project git,
citation/command autocomplete, symbol palette, file outline, templates,
zip and git import, dark mode.

## Stage A — Team security & access control
The gap: signup is open to anyone who can reach the server, there's no
rate limiting, no admin controls, sessions never expire, and the cookie
lacks the `secure` flag for TLS deployments.

- First registered account becomes **admin**; existing deployments:
  oldest user is migrated to admin.
- **Invite-only signup** (default once one user exists): admins mint
  single-use invite codes/links; `QUIRELOOP_OPEN_SIGNUP=true` re-opens
  public signup for those who want it.
- **Admin panel**: list users, deactivate/reactivate, revoke sessions,
  manage invites.
- **Login rate limiting** (per-IP + per-account, in-memory, no new deps).
- **Session hardening**: 30-day expiry, `secure` cookie flag via
  `QUIRELOOP_SECURE_COOKIES=true` for TLS/nginx deployments.
- **Password change** (self-service, requires current password).

## Stage B — Collaboration depth
- **Roles**: collaborators are `editor` or `viewer` (read-only opens,
  no writes/compiles blocked reads).
- **Link sharing**: tokenized invite links with a role attached,
  revocable.
- **Comments**: anchored to text ranges (Yjs relative positions so they
  survive concurrent edits), threaded, resolvable.
- **Track changes / suggest mode**: edits recorded as pending
  insertions/deletions, accept/reject per change. (Riskiest item —
  sequenced last, may ship behind a toggle.)
- **Project chat** sidebar over the existing websocket layer.

## Stage C — Writing & compile experience
- **Spell check** in the editor (client-side dictionary, per-project
  ignore list).
- **Project-wide search** (server-side grep across project files, UI
  panel with jump-to-match).
- **Friendly compile errors**: parse the LaTeX log into per-line
  diagnostics shown as editor gutter markers + a structured error list,
  not a wall of log text.
- **Auto-compile on idle** (toggleable).
- **Version diff view**: compare any two snapshots side-by-side.
- **Vim keybindings** (toggle), keyboard-shortcut reference.

## Stage D — Deployment for real users
- **Dockerfile + docker-compose** (app + TeX Live), volume-mounted data
  dir, health endpoint.
- **nginx reference config** (TLS, websocket upgrade for `/ws`),
  systemd unit for bare-metal installs.
- **Ops docs**: install guide, backup/restore (the data dir is
  everything), upgrade path, admin guide.

## Non-goals
- No database — plain files/JSON only, sized for a lab (tens of users),
  not a public SaaS.
- No rich-text/WYSIWYG editor mode — source
  editing with a great preview is the identity here.
- No external sync integrations (Dropbox, Mendeley) for now; git covers
  interop.
