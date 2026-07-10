# Scriptorium

A self-hosted web IDE for writing LaTeX: a project/file manager, a code
editor with LaTeX syntax highlighting and autocomplete, a live PDF preview,
and version history — all running on your own machine. No account, no
cloud, no subscription. Everything — the app and your project files — lives
in one folder on disk.

## What this is (and isn't)

This is a **single-user, local-only** LaTeX editor. It's meant to be run on
your own computer (or a machine you trust on your own network), not deployed
as a public multi-tenant service.

It intentionally does **not** include accounts, login, project sharing, or
real-time multi-user collaboration. An earlier version of this project had
all of that, built on WebSockets and CRDTs — it worked, but added a lot of
moving parts (sessions, WebSocket auth, conflict merging) for a feature most
single-user setups don't need, and it made the whole app more fragile. This
release strips that back down to the reliable core: **a fast, no-nonsense
LaTeX IDE with autosave and version history.** If you want multi-user
editing, point a proper collaboration layer at it yourself, or watch this
space.

## Features

- **Projects & files** — multiple projects, nested folders, image/`.bib`
  uploads, drag-and-drop, rename/delete.
- **Templates** — start a new project from Blank, Article, Report, Beamer,
  or CV/Resume.
- **Editor** — CodeMirror 6 with LaTeX syntax highlighting, autocomplete,
  code folding, find & replace, a symbol/snippet insert palette, dark mode,
  and autosave.
- **Compile** — LaTeX → PDF via `latexmk` (pdfLaTeX / XeLaTeX / LuaLaTeX,
  switchable per project), with clickable compile errors that jump straight
  to the offending line.
- **PDF preview** — zoom, fit-width, page jump, and two-way **SyncTeX**
  (click in the PDF to jump to source, and vice versa).
- **Version history** — automatic snapshots on every successful compile,
  plus manual named snapshots, with one-click restore.
- **Import from the hosted editor** — paste an the hosted editor project's git URL (and a git
  token, if it's private) to clone it in as a new local project. One-time
  import, not a live sync — after that it's just a regular local project.
- **Download** — grab the compiled PDF or the whole project as a `.zip`.
- **Outline panel** — jump between `\section`/`\chapter` headings; live
  word count.
- **Dark mode** — toggle on the dashboard or in the editor; defaults to your
  system's light/dark setting on first visit.

## Prerequisites

- **Node.js 20+**
- **A LaTeX distribution** with `latexmk` and `synctex` on your `PATH` —
  e.g. [TeX Live](https://tug.org/texlive/) or [MacTeX](https://tug.org/mactex/)
  on macOS, TeX Live on Linux, or [MiKTeX](https://miktex.org/) on Windows.
  Nothing LaTeX-related is bundled — this app shells out to your existing
  install. Verify it's on your PATH:

  ```
  latexmk --version
  synctex version
  ```

## Setup

```
git clone <this-repo-url> scriptorium
cd scriptorium
npm install
```

This installs dependencies for both the `server/` and `web/` workspaces.

## Running it

**Quick start (production mode, one server, one port):**

```
cd web && npm run build && cd ..
cd server && npm start
```

Then open **http://localhost:4173**. The port can be changed with the
`PORT` environment variable, e.g. `PORT=8080 npm start`.

To reach it from another device on your network, use
`http://<this-machine's-LAN-IP>:4173` — the server binds to all interfaces.

**Development mode (auto-reload while hacking on the app itself):**

```
cd server && npm start        # terminal 1 — API on :4173
cd web && npm run dev         # terminal 2 — UI on :5173 with hot reload
```

Open `http://localhost:5173` in dev mode; API calls are proxied to the
server in `web/vite.config.js`.

The repo ships with one **Sample Project** already in place (with a compiled
PDF and one version-history entry) so you have something to open immediately
— delete it whenever you're ready to start your own paper.

## Where your data lives

Every project is a plain folder on disk under `data/projects/<id>/` — a
`manifest.json` plus your `.tex`/`.bib`/image files, exactly as you'd have
them locally. There is no database. Back it up, sync it, or move it just by
copying the `data/` folder. Deleting this repo's folder deletes everything
in it, so back up `data/` separately if it matters to you.

New projects you create aren't tracked by git (see `.gitignore`) — only the
bundled sample project is, so your own papers never accidentally end up in
your fork's history.

## Project structure

```
server/   Fastify API — project/file management, latexmk compile, SyncTeX
web/      React + CodeMirror 6 frontend (Vite)
data/     Your projects (git-ignored — this is created on first run)
```

## Security note

There is no authentication. Anyone who can reach the port can read, edit,
and delete every project and run `latexmk` on your machine. That's fine on
`localhost` or a home network you trust; do **not** expose this port
directly to the public internet. If you need remote access, put it behind
your own auth (a reverse proxy with basic auth, a VPN, Tailscale, etc.).

## License

Apache 2.0 — see [LICENSE](LICENSE).
