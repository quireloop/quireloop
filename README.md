<p align="center">
  <img src="assets/logo.svg" width="96" height="96" alt="Quireloop logo">
</p>

<h1 align="center">Quireloop</h1>

<p align="center">Created by <a href="https://github.com/arjunpogaku">Arjun Pogaku</a> · PolyForm Noncommercial 1.0.0</p>

A self-hosted, multi-user web IDE for writing LaTeX: a project/file
manager, a real-time collaborative code editor with LaTeX syntax
highlighting and autocomplete, a live PDF preview, comments and chat, and
full version history — all running on hardware you own. No per-seat
subscription, no vendor lock-in. Everything — the app and every project —
lives on your own server.

## What this is (and isn't)

This is a **self-hosted team LaTeX editor**, built for a lab or research
group to run on a machine they control (their own server, a lab box, a
small VPS) instead of renting an subscription per collaborator.
It has accounts, invite-only signup, an admin panel, roles (editor/viewer),
share links, and real-time collaborative editing (Yjs CRDT) with
attribution, comments, and chat — the collaboration features the hosted editor
paywalls are just built in here.

It is **not** a public multi-tenant SaaS — there's no database, no
per-tenant isolation beyond per-user file ownership, and it's sized for
"tens of users on hardware a lab already owns," not thousands of strangers
signing up over the open internet. See [DEPLOYMENT.md](DEPLOYMENT.md) for
running it as a shared server for your team, with TLS in front of it, and
[USER_GUIDE.md](USER_GUIDE.md) for a complete walkthrough of every feature
once it's running.

## Features

- **Log in with the server's own accounts** — optionally authenticate against
  the host's UNIX accounts through PAM, so members use the same username,
  password and authenticator they already use for SSH, and their projects
  live in their real home directory with nothing to configure. Email/password
  accounts still work alongside it for collaborators without a shell.
- **Accounts & access control** — email/password accounts with TOTP 2FA,
  invite-only signup by default (`QUIRELOOP_OPEN_SIGNUP=true` to open it
  up), an admin panel (list/deactivate users, revoke sessions, manage
  invites), per-IP and per-account login rate limiting, and 30-day
  sessions with a `secure`-flag cookie option for TLS deployments.
- **Real-time collaboration** — multiple people editing the same file at
  once (Yjs CRDT), with each collaborator's cursor and attribution visible
  live, backed by server-side persistence so edits survive a restart.
- **Roles & sharing** — collaborators are `editor` or `viewer` per project;
  revocable, tokenized share links carry a role with them.
- **Comments & chat** — comments anchored to text ranges (survive
  concurrent edits), threaded and resolvable; a project chat sidebar
  alongside the editor.
- **Projects & files** — multiple projects, nested folders, image/`.bib`
  uploads, drag-and-drop, rename/delete.
- **Open folders already on disk** — a paper that already lives at
  `/home/you/papers/thesis` on the server (or on your own machine, running
  locally) opens as a project *in place*, from a browser in the dashboard:
  no import, no copy, edits go straight to the real files and the PDF is
  built next to them. Removing the project leaves the folder untouched.
  Each member sees their own home directory and nobody else's, with no
  configuration needed; admins can point an account at a specific folder,
  and `QUIRELOOP_LIBRARY_DIRS` adds shared ones.
- **Templates** — start a new project from Blank, Article, Report, Beamer,
  or CV/Resume.
- **Editor** — CodeMirror 6 with LaTeX syntax highlighting, autocomplete,
  code folding, find & replace, a symbol/snippet insert palette, spell
  check, optional Vim keybindings, dark mode, and autosave.
- **Project-wide search** — grep across every file in a project, with a
  jump-to-match panel.
- **Compile** — LaTeX → PDF via `latexmk` (pdfLaTeX / XeLaTeX / LuaLaTeX,
  switchable per project), with parsed compile errors shown as editor
  gutter markers and a structured error list — not a wall of raw log text
  — plus optional auto-compile on idle.
- **PDF preview** — zoom, fit-width, page jump, and two-way **SyncTeX**
  (click in the PDF to jump to source, and vice versa).
- **Version history** — automatic snapshots on every successful compile,
  plus manual named snapshots, one-click restore, and a side-by-side diff
  view between any two snapshots.
- **Import from the hosted editor** — paste an the hosted editor project's git URL (and a git
  token, if it's private) to clone it in as a new local project. One-time
  import, not a live sync — after that it's just a regular local project.
- **Upload a project** — pick a `.zip` (e.g. the hosted editor's own "Download .zip",
  or any folder of `.tex`/`.bib`/image files you zip up yourself) to bring
  it in as a new project. Handles zips that wrap everything in one folder.
- **Source Control** — every project is its own real git repository from the
  moment you create it (not a Quireloop-specific format). A VS Code–style
  panel in the editor shows changed files, lets you write a commit message
  and commit, and push/pull to a remote you set per project — a GitHub repo,
  a GitLab repo, or back to the hosted editor's own git bridge. Nothing is pushed
  automatically; you're always in control of when.
- **Download** — grab the compiled PDF or the whole project as a `.zip`.
- **Outline panel** — jump between `\section`/`\chapter` headings; live
  word count.
- **Dark mode** — toggle on the dashboard or in the editor; defaults to your
  system's light/dark setting on first visit.

## Two editions, one codebase

| | **Solo Edition** | **Server Edition** |
|---|---|---|
| For | One researcher, on their own machine | A lab or team, on a shared server |
| Install | Clone + `npm install` + run (below) | Docker or bare metal behind TLS — see [DEPLOYMENT.md](DEPLOYMENT.md) |
| Accounts | Just yours (first signup = admin) | Invite-only signup, roles, admin panel |
| Collaboration | Everything still works if you later invite someone on your LAN | Real-time editing, comments, chat, track changes over the network |
| Where papers live | `data/` on your machine | `data/` on the server (the one thing to back up) |

There is no feature switch — the Solo Edition **is** the full app running
locally for one person. If your lab later wants in, the same install
becomes a Server Edition by putting it on a shared machine per
[DEPLOYMENT.md](DEPLOYMENT.md); your `data/` directory moves with it.

## Prerequisites (both editions)

- **Node.js 22+**
- **A LaTeX distribution** with `latexmk` and `synctex` on your `PATH` —
  e.g. [TeX Live](https://tug.org/texlive/) or [MacTeX](https://tug.org/mactex/)
  on macOS, TeX Live on Linux, or [MiKTeX](https://miktex.org/) on Windows.
  Nothing LaTeX-related is bundled — this app shells out to your existing
  install. On Debian/Ubuntu you can install everything needed with
  `npm run setup:texlive` after cloning (below), instead of hunting down
  the right TeX Live package names yourself. Verify it's on your PATH:

  ```
  latexmk --version
  synctex version
  ```

- **`git` and `unzip`** on your `PATH` — `git` backs every project's version
  control (Source Control panel, Import from the hosted editor); `unzip` backs
  "Upload Project (.zip)". Both ship by default on macOS and most Linux
  distros.

## Solo Edition — install and run

```
git clone https://github.com/arjunpogaku/quireloop.git
cd quireloop
npm install
npm run build --workspace=web
cd server && npm start
```

Open **http://localhost:4173**, sign up (your account is the admin), and
write. That's the whole install.

**Always-on (recommended for day-to-day solo writing), macOS only:**

The friction of "open a terminal and start the server" before you can even
begin writing is real — this makes Quireloop behave like an installed app
instead of a dev project you have to boot up:

```
npm install
npm run build --workspace=web
npm run service:install
```

This installs a [LaunchAgent](https://www.launchd.info/) that starts
Quireloop at login and keeps it running in the background — restarting it
automatically if it ever crashes. From then on, opening
**http://localhost:4173** (bookmark it) just works, every time, with
nothing to remember to start first. Logs land in
`~/Library/Logs/Quireloop/`. To stop it running at login:
`npm run service:uninstall`.

On Linux, the equivalent is a `systemd --user` unit running
`node server/src/start.js` with `WantedBy=default.target`; there's no
installer script for that here yet.

The port can be changed with the `PORT` environment variable, e.g.
`PORT=8080 npm start`. To reach it from another device on your network,
use `http://<this-machine's-LAN-IP>:4173` — the server binds to all
interfaces.

**Server Edition:** same code, run on a shared machine with TLS in front —
Docker, nginx, and systemd walkthroughs are in
[DEPLOYMENT.md](DEPLOYMENT.md).

**Development mode (auto-reload while hacking on the app itself):**

```
cd server && npm start        # terminal 1 — API on :4173
cd web && npm run dev         # terminal 2 — UI on :5173 with hot reload
```

Open `http://localhost:5173` in dev mode; API calls are proxied to the
server in `web/vite.config.js`.

First visit prompts you to create an account — **the first account created
becomes the admin** (see the [security note](#security-note) below).
From there you'll land on an empty dashboard — create a project, import
one from the hosted editor, or upload a `.zip` to get started. Invite the rest of
your lab from the admin panel; see [DEPLOYMENT.md](DEPLOYMENT.md) if
you're setting this up as a shared server rather than just for yourself.

## Where your data lives — and why it's kept separate from this repo

There are deliberately **two completely separate git histories** at play,
and they never mix:

1. **This repo** (Quireloop's own source code) — what you cloned. It has
   no knowledge of any paper you write with it.
2. **Each project's own repo**, created automatically the moment you make a
   project, living at `data/projects/<id>/`. That folder is *entirely*
   `.gitignore`d by this repo (see the root `.gitignore` — just one line,
   `data/`), so nothing you write ever becomes part of Quireloop's commit
   history, and a `git status` in this repo never shows your papers.

Each project folder holds plain files — a `manifest.json` (Quireloop's own
bookkeeping) plus your real `.tex`/`.bib`/image files exactly as you'd have
them locally — with its own `.git` underneath, its own commit history, and
optionally its own remote (configured per project in the **Source Control**
panel). Quireloop's bookkeeping (`manifest.json`, `build/`, `versions/`,
and the file that stores your remote's access token) is excluded from that
inner repo too, via a `.gitignore` Quireloop writes into every project —
so if you push a project to GitHub or back to the hosted editor, only your actual
paper goes with it, never Quireloop's internals or your token.

`data/` also holds the plain-JSON account/session state (`users.json`,
`invites.json`, the session-signing key) alongside `data/projects/`. There
is no database anywhere. Back up `data/` however you like — Time Machine,
syncing it to another drive, or (for the project files specifically)
pushing each project to its own remote. Deleting this repo's folder
deletes everything in it, `data/` included, so keep that backup separate
from your clone of this repo.

## Project structure

```
server/   Fastify API — accounts, project/file management, real-time
          collaboration, latexmk compile, SyncTeX
web/      React + CodeMirror 6 frontend (Vite)
data/     Accounts + your projects (git-ignored — created on first run)
```

## Deploy it for your lab

Running it locally for yourself (above) needs nothing beyond `npm start`.
Running it as a shared server for a team — Docker image with TeX Live
baked in, an nginx reference config for TLS and the WebSocket collab
endpoint, a systemd unit for bare-metal installs, backup/upgrade
procedure, and every `QUIRELOOP_*` environment variable — is covered in
**[DEPLOYMENT.md](DEPLOYMENT.md)**.

## Security note

The first account created on a fresh deployment becomes the admin; every
signup after that requires an admin-issued invite by default (see
`QUIRELOOP_OPEN_SIGNUP` in [DEPLOYMENT.md](DEPLOYMENT.md) to change that).
Even so, this is built for a trusted lab/team, not a public-internet
signup flow — there's no email verification, no per-tenant billing/quota
isolation, and it's sized for tens of users, not a stranger-facing SaaS.
If you're exposing it beyond `localhost` or a network you trust, put TLS
in front of it (the nginx reference config in `deploy/` covers this) so
credentials and project content aren't sent in the clear.

## License

PolyForm Noncommercial License 1.0.0, with Attribution Addendum — see
[LICENSE](LICENSE).

**In short:** free for any noncommercial use — individuals, students,
researchers, universities, government and public-research institutions,
nonprofits — no need to ask, as long as you credit Quireloop / Arjun Pogaku
in any resulting publication or public description of the work (see
[CITATION.cff](CITATION.cff) for a ready-made citation). Commercial use
(for-profit companies) isn't covered by this license — email
pchakri.rj@gmail.com to arrange a separate commercial license. This is a
source-available license, not an OSI-approved open-source license — see the
LICENSE file for the full terms.
