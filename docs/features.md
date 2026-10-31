# Features

The full list of what Quireloop does. For how to use each one, see the
[user guide](user-guide.md).

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
- **PDF preview** — zoom, fit-width, page jump, selectable text, find in
  PDF, a dark reading mode, and two-way **SyncTeX**: double-click a word in
  the PDF to land on that word in the source, or double-click in the source
  to outline it in the PDF, hosted-editor-style.
- **Hover previews** — typeset equations (with your own macros) and
  `\cite` references, as in VS Code's LaTeX Workshop.
- **Paste or drop images** — screenshots and image files go into `figures/`
  with a ready-made `figure` block inserted.
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
- **Command search** — Ctrl/Cmd+K finds any command or project file from one
  box.
