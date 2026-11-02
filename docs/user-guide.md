# Quireloop User Guide

Everything you need to know to use Quireloop, from your first login to advanced
collaboration. This guide is for **users** of a running Quireloop server. If you
are the person *setting up* the server, start with [Install on a server](install-server.md)
and come back here.

## Contents

1. [What is Quireloop?](#what-is-quireloop)
2. [First run: creating the admin account](#first-run-creating-the-admin-account)
3. [Accounts, invites, and logging in](#accounts-invites-and-logging-in)
4. [Securing your account (2FA, password)](#securing-your-account-2fa-password)
5. [The admin panel](#the-admin-panel)
6. [The dashboard: creating and importing projects](#the-dashboard-creating-and-importing-projects)
7. [The editor](#the-editor)
8. [Compiling](#compiling)
9. [Real-time collaboration](#real-time-collaboration)
10. [Sharing a project](#sharing-a-project)
11. [Comments](#comments)
12. [Project chat](#project-chat)
13. [Track changes (suggest mode)](#track-changes-suggest-mode)
14. [The AI writing assistant](#the-ai-writing-assistant)
15. [Version history](#version-history)
16. [Git integration](#git-integration)
17. [Syncing with a git remote](#syncing-with-a-git-remote)
18. [Working offline with a server](#working-offline-with-a-server)
18. [Where your data lives, and backups](#where-your-data-lives-and-backups)
19. [Troubleshooting](#troubleshooting)

---

## What is Quireloop?

Quireloop is a self-hosted, collaborative LaTeX editor that your lab runs on
its own server. It is licensed for [academic use only](../README.md#license).
Your papers never leave your hardware, there are no subscriptions, and there
are no artificial limits on collaborators, compile time, or history.

The core loop is simple: source on the left,
PDF on the right, live collaboration in between.

---

## First run: creating the admin account

The **very first account** created on a fresh server can sign up freely —
no invite needed. Open the server's URL in a browser, click **Sign up**,
and enter an email and password (8+ characters).

That first account is automatically the **admin**. Every account after it
needs an invite (see below), unless the server was started with
`QUIRELOOP_OPEN_SIGNUP=true`.

> **If you're setting up a lab server:** create this first account yourself,
> immediately enable 2FA on it, then invite everyone else.

---

## Accounts, invites, and logging in

### Joining with an invite

An admin gives you either an **invite link** or an **invite code**:

- **Link** — open it, and the signup form appears with the code pre-filled.
  Choose your email and password and sign up.
- **Code** — go to the server URL, click **Sign up**, and paste the code into
  the invite-code field.

Invite codes are single-use: once you've signed up with one, it's spent.

### Logging in

Enter your email and password. If your account has 2FA enabled, you'll be
asked for the 6-digit code from your authenticator app as a second step.

Sessions survive server restarts — you won't be logged out when the admin
upgrades the server.

### Rate limiting

Repeated failed logins (or failed 2FA codes) are rate-limited per account and
per IP address. If you hit the limit you'll see a "try again later" message
with a wait time — this is normal brute-force protection, not a broken account.

---

## Securing your account (2FA, password)

Open the **user menu** (your email, top-right of the dashboard) →
**Account settings**.

### Two-factor authentication (2FA)

1. Click **Enable 2FA**. A QR code appears.
2. Scan it with any TOTP authenticator app (Google Authenticator, Authy,
   1Password, Aegis, …).
3. Enter the 6-digit code the app shows to confirm. Codes are only accepted
   once the app and server agree, so a typo just means "try the next code".

From then on, every login asks for a current code after your password.
To turn it off, use **Disable 2FA** (requires a valid current code).

> **Losing your authenticator locks you out.** There are no backup codes in
> this version — if that happens, a server admin has to help you (see
> Troubleshooting).

### Changing your password

Account settings → **Change password**. You must provide your current
password. Other devices' sessions stay valid; log them out by changing the
password again if a device is lost (or ask an admin to disable/re-enable
your account, which kills all sessions).

---

## The admin panel

Visible only to admins, via the **Admin** link in the dashboard header.

### Invites

- **Create invite** — generates a single-use code and a ready-to-share link.
  Send either to the person you're inviting.
- The list shows every outstanding invite and who has used which.
- **Revoke** deletes an unused invite so its code stops working.

### Users

Every account on the server is listed with its email and status.

- **Disable** — the user is locked out immediately: their sessions are
  killed and logins rejected. Their projects stay on disk untouched.
- **Enable** — reverses a disable.

Admins cannot see or open other users' projects from the panel — access to a
project always goes through its sharing settings.

---

## The dashboard: creating and importing projects

After login you land on the dashboard: your projects plus anything shared
with you (marked with a **Shared** badge).

### Creating a project

Pick a template — **Blank**, **Article**, **Report**, **Beamer
Presentation**, or **CV / Resume** — enter a name, and click **New Project**.

### Importing from git

**Import from Git…** clones any project from a git URL, with a token if it is
private. The project keeps its remote, so you can push straight back.

### Uploading any zip

**Upload Project (.zip)…** works for any zipped LaTeX project. Quireloop looks
for a main `.tex` file (one containing `\documentclass`) and builds the file
tree from the archive.

### Downloading and deleting

Each project card has **Download .zip** (the full project source — this is
also your escape hatch: your work is always exportable) and **Delete**
(owner only, asks for confirmation, removes the project and its history).

---

## The editor

Opening a project gives you the three-pane view: **sidebar** (files/outline/
search/git), **source editor**, and **PDF preview**.

### The sidebar

Four tabs at the top:

- **Files** — the project tree. `+ New` creates a file (use `/` in the name
  to create it inside a folder, e.g. `sections/intro.tex`), `+ Folder`
  creates a folder, **Upload** adds files from your machine (figures, `.bib`,
  anything). Each file row has rename (✎) and delete (×) buttons.
- **Outline** — the section structure of the open file
  (`\section`, `\subsection`, …). Click any entry to jump to it.
- **Source Control** — per-project git (see [Git integration](#git-integration)).
- **Search** — project-wide text search across every file, with per-match
  jump-to-line.

### Writing

- **LaTeX autocomplete** — start typing a command (`\beg…`) and completions
  appear, including snippet-style environments (`\begin{figure}` inserts the
  whole block with placeholders).
- **Citation autocomplete** — type `\cite{` and every key from the project's
  `.bib` files is offered, with title previews.
- **Symbol palette** — the **Insert** button opens a categorized palette of
  math symbols, Greek letters, arrows, and operators; click one to insert
  its LaTeX at the cursor.
- **Spell check** — the **Aa** toggle turns on the browser's native spell
  checker. It's off by default because browsers also underline LaTeX
  commands; it's most useful for prose-heavy passes.
- **Vim mode** — the **Vim** toggle enables Vim keybindings. Vim's `u` /
  `Ctrl-r` are wired into the collaborative undo history, so undo in Vim
  mode never destroys collaborators' work.
- **Dark/light theme** — the ☀/🌙 toggle, applied across editor and UI.
- **Undo/redo** — `Cmd/Ctrl-Z`, `Cmd/Ctrl-Y`. Undo is *yours*: it only
  reverts your own edits, never a collaborator's.
- **Equation preview** — hover over any math (`$…$`, `\(…\)`, `\[…\]`,
  `$$…$$`, `equation`/`align`/`gather`/`multline`…) to see it typeset. Your
  own `\newcommand`, `\DeclareMathOperator` and `\def` macros from the main
  file and the open file are applied.
- **Citation preview** — hover a key inside any `\cite`-style command to see
  the reference's title, authors, venue and year from the project's `.bib`
  files (or a warning if the key isn't defined).
- **Paste or drop images** — paste a screenshot, or drag image/PDF files into
  the editor: they're uploaded to `figures/` (pasted screenshots get a
  timestamped name, never overwriting an existing file) and a
  `\begin{figure}…\includegraphics…\end{figure}` block is inserted where you
  pasted or dropped.
- **Folding** — fold sections and environments from the gutter arrows, or
  with `Ctrl-Shift-[` / `Ctrl-Shift-]` (`Cmd-Alt-[` / `Cmd-Alt-]` on macOS).

### The PDF pane

Rendered PDF with zoom and page navigation. It updates after each compile.

- **Select and copy text** — the PDF has a real text layer, so you can select
  and copy from it.
- **Find in PDF** — type in the *Find in PDF* box (or press `Cmd/Ctrl-F`
  while the PDF pane has focus). `Enter` / `Shift-Enter` step through matches,
  `Esc` clears them.
- **Dark PDF** — the *◐ Dark PDF* toggle shows pages inverted for reading at
  night. Display only: the PDF file itself is unchanged.

---

## Compiling

- **Compile** — runs `latexmk` on the server against the project's main
  file. The right pane refreshes with the new PDF. Shortcuts:
  `Cmd/Ctrl-Enter` or `Cmd/Ctrl-S`. The main file may live in a subfolder
  (e.g. `ms/paper.tex`).
- **Engine picker** — pdfLaTeX (default), XeLaTeX, or LuaLaTeX, remembered
  per project. Use XeLaTeX/LuaLaTeX for `fontspec`/system fonts.
- **Auto** — auto-compile: when toggled on, the project recompiles shortly
  after you stop typing.
- **Problems / log** — errors and warnings are parsed out of the LaTeX log
  into a readable list; click an entry to jump to the offending file and
  line (marked in the editor gutter). The raw log is available too, for
  the cases where LaTeX's own message is the only truth.
- **Clean Aux Files** — deletes `.aux`/`.log`/`.out`-style build debris.
  Reach for it when a broken build gets "stuck" (stale `.aux` state is the
  classic cause).
- **Bibliography** — `latexmk` handles the `bibtex`/`biber` reruns
  automatically; just `\cite` and compile.

### SyncTeX (jump between source and PDF)

- **Source → PDF**: double-click a word in the editor (or press
  `Ctrl-Alt-J` at the cursor); the PDF scrolls there, outlines everything
  that line produced, and marks the word itself.
- **PDF → source**: double-click a word in the PDF; the editor opens the
  matching file, selects that word on its line, and briefly flashes the line.
  Works for `\input`/`\include`d files and for projects opened in place from
  a folder on the server.

---

## Real-time collaboration

Everyone with access to a project can open it at the same time. Edits
appear in collaborators' editors within a fraction of a second, with each
person's cursor and selection shown in their own color, labeled with their
email.

- The **sync indicator** next to the toolbar shows **Synced** or
  **Offline — changes saved locally**. If your connection drops, keep
  typing: edits are stored in your browser and merge automatically when
  the connection returns. Conflicting concurrent edits merge without
  losing either side (the editor uses CRDTs — there is no "locking" and
  no "someone else saved first" error, ever).
- **Recently edited by** — near the toolbar you'll see who has touched the
  currently open file recently.
- Collaboration is per-file: two people can also work in *different* files
  of the same project with zero interaction.

---

## Sharing a project

The **Share** button (project owner only) opens the sharing modal.

### Inviting by email

Enter the email of another account **on the same server**, pick a role, and
add them:

- **Editor** — can open, edit, compile, comment, chat, and suggest.
- **Viewer** — read-only: can open the project, read the source, view the
  PDF, read comments and chat, and see suggestions — but cannot change
  anything. Viewers don't get edit toolbars, and the server enforces
  read-only regardless of what a client sends.

You can change a collaborator's role or remove them at any time from the
same modal. Only the owner can delete the project or manage sharing.

### Share links

Also in the Share modal: create a **share link** with a role (editor or
viewer). Anyone with an account on the server who opens the link joins the
project at that role — handy for adding a whole group without typing each
email. Links can be revoked at any time; joining is idempotent (opening the
link twice doesn't duplicate or downgrade anyone).

> Share links grant access to anyone on the server who has the URL. For
> sensitive projects, prefer per-email invites.

---

## Comments

1. Select the text you want to comment on.
2. Click **💬 Comment** and write your note.
3. The commented range gets a highlight; the **Comments** panel lists every
   thread.

In the panel you can **reply** (threads), **resolve** (the highlight
disappears but the thread is kept, marked resolved — and can be reopened),
and **delete** a thread entirely.

Comments are anchored to the *content*, not to line numbers — they stay
attached to their text as the document is edited around them, even by
other people simultaneously.

---

## Project chat

The **Chat** button opens a per-project message panel — quick coordination
("compiling now, don't touch section 3") without leaving the editor.
Messages show author and time, and everyone with project access (including
viewers) can read and write.

---

## Track changes (suggest mode)

For supervised edits: propose changes without
silently rewriting the document.

### Making suggestions

Toggle **✏ Suggest** in the toolbar. While it's on:

- **Typing** inserts your text into the document highlighted in green and
  records a pending *insertion* suggestion under your name. The text is
  live immediately — the paper still compiles with it — but everyone can
  see it's provisional.
- **Deleting** (Backspace/Delete over a selection or character) does **not**
  remove anything. The text gets a red strikethrough and a pending
  *deletion* suggestion is recorded. Nothing disappears until someone
  accepts it.

Toggle **✏ Suggest** off to go back to normal direct editing.

### Reviewing suggestions

The **Suggestions** button (with a pending count) opens the panel. Each
card shows the type (➕ Insertion / ➖ Deletion), the author, and when it
was made, with two actions:

- **Accept** — an insertion is simply confirmed (the highlight goes away);
  a deletion actually removes the struck-through text.
- **Reject** — an insertion's staged text is removed from the document;
  a deletion is dismissed and the text stays.

Any editor can accept or reject; viewers can see suggestions but not act
on them. Suggestions are anchored like comments — they follow their text
through concurrent edits, and resolving one that overlaps another (say,
accepting a deletion that swallowed someone's pending insertion) cleans up
both.

---

## The AI writing assistant

Enable it from inside the app: **Admin panel → ✨ Assistant tab**, paste an
Anthropic API key (from [console.anthropic.com](https://console.anthropic.com/settings/keys)),
pick a model — it takes effect immediately, no restart, no terminal.
(Ops-managed servers can set `QUIRELOOP_ANTHROPIC_API_KEY` in the
environment instead; the env var wins. See [the server guide](install-server.md).)

> **API key, not a Claude subscription.** Claude Pro/Max plans cover
> claude.ai and Claude Code but do not include API access — the assistant
> needs a pay-as-you-go API key from the Anthropic console. Typical
> paper-writing questions cost fractions of a cent to a few cents each.

Once a key is set, a **✨ Assistant** button appears in the editor toolbar.
It opens a Claude-powered side panel that helps you write the paper you
have open:

- **It sees your open file** — ask "why doesn't this compile?", "tighten my
  abstract", "turn this list into a table", or "rewrite this paragraph in a
  more formal register" without pasting anything.
- **Select text first** to ask about a specific passage — the selection is
  sent along with your question.
- **Code blocks are one-click**: any LaTeX the assistant produces appears in
  a code block with **Copy** and **Insert** buttons; Insert drops it at your
  cursor (and plays nicely with track changes — insert while Suggest mode is
  on and it becomes a reviewable suggestion).
- **Stop** cancels a response mid-stream; **Clear** starts a fresh
  conversation. Conversations are per-panel-session and are not stored on
  the server.

Everyone with access to the project can use it, including viewers (they just
don't get the Insert button). The assistant reads the file as saved on disk —
in a live collaboration it may lag your unsynced keystrokes by a second or
two.

> **Costs**: assistant usage is billed to the server's API key. Be
> reasonable; your admin can see the aggregate usage in the Anthropic
> console.

> **It never edits on its own.** The assistant only produces text in the
> panel — nothing touches your document until you click Insert.

---

## Version history

The **History** button opens the version panel.

- **Save version** — snapshot the entire project right now, with an
  optional label ("submitted to NeurIPS", "before restructuring §4").
- **Restore** — roll the whole project back to a snapshot. A safety
  snapshot of the current state is taken first, so restoring is never
  destructive — you can restore your way back forward. Open collaborative
  sessions pick up the restored content; a stale editor can't silently
  overwrite a restore.
- **Diff** — compare any snapshot against the current state of the project,
  file by file, in a unified view with unchanged runs collapsed.

Snapshots are full copies stored server-side with the project — they're
included in server backups and in nothing else (not in your project zip
download, not in git pushes).

---

## Git integration

Every project is quietly a git repository, exposed through the **Source
Control** sidebar tab.

- **Changes list** — files modified since the last commit.
- **Commit** — write a message and commit everything pending.
- **Remote** — connect the project to any HTTPS git remote (GitHub, GitLab,
  your institution's server). Provide the repo URL and an access token
  (e.g. a GitHub fine-grained personal access token with contents
  read/write on that repo). The token is stored only in a private file
  inside the project on the server — it is never written into git config
  and never pushed.
- **Push / Pull** — sync with the remote. Pull merges remote changes into
  the project (and the live editors pick them up).

Quireloop's own bookkeeping — build output, version snapshots, comment/
chat/suggestion data — is automatically `.gitignore`d, so what you push is
a clean LaTeX repository containing only your paper.

> Git here is for **off-server backup and interop** (your co-author who
> insists on working locally can clone the repo). For everyday
> collaboration, the real-time editor is the primary path — you never need
> to pull before editing.

---

## Syncing with a git remote

You can keep a project in step with any git host:

1. On the host, create an access token and note the repository's URL.
2. In Quireloop: open the project's **Source Control** tab → **Set remote**,
   paste the URL and the token.
3. **Pull** brings down changes from the remote; **Commit** + **Push** sends
   yours.

This is not live: changes arrive when you Pull and leave when you Push. If the
same paragraph changed on both sides, git flags a conflict for you to resolve.

---

## Working offline with a server

Install Quireloop on your own computer and link it to your lab's server. Your
computer then keeps a full copy of every paper you can open on the server. You
always work in that copy, so losing the internet changes nothing: edit, compile
and save as usual, and everything catches up by itself when the connection
returns.

### Linking your computer

1. Open Quireloop on your computer and sign in. Use the first account, which is
   the admin.
2. Under **Work with a server**, enter the server's address, such as
   `https://your-server/quireloop`, and a name for this computer.
3. If the server uses its own certificate, check that it is your server and
   choose **Trust and continue**.
4. Open the link it shows, sign in to the server, check that the code matches,
   and choose **Approve**.

Your password and two-factor code are typed only into the server's page. Your
computer receives a token that works for syncing and nothing else. To remove a
computer, for example a lost laptop, open your account menu on the server and
use **Linked computers**.

### What happens while you work

- **Online:** the computer checks every paper every 30 seconds. A file you have
  open is linked live, so you see co-authors' typing and cursors as they happen,
  and they see yours.
- **Offline:** you keep working. The toolbar shows that you are offline.
- **Back online:** text edits made on both sides are merged, even in the same
  paragraph. Nothing needs resolving.

Figures and other files that are not text can't be merged. If one changed on both
sides, the server's version keeps the name and yours is saved beside it, such as
`figure.laptop-20261102-1430.png`, with a note on your projects page.

If many files vanish from one side at once, Quireloop treats that as damage. It
deletes nothing and brings the files back.

### Good to know

- Papers you can only view on the server are read-only on your computer.
- **Put on server** on a project card uploads a paper you started on your computer.
- **Delete** on a synced paper removes only your computer's copy. It stops being
  copied there until you link the computer again.
- If you lose access to a paper, your computer keeps its copy as a normal project.
- Comments, chat, suggestions, version history and git commits are **not** synced.
  Each copy has its own. Use the server when these need to be shared.
- Files over 100 MB are not copied, and your projects page lists them.
- Compiling on your computer needs LaTeX installed there. It also runs LaTeX
  written by your co-authors, so install the
  [compile sandbox](install-server.md#what-a-compile-may-touch) on Linux.
- If the server's certificate changes, syncing stops until you link again. Your
  work stays safe on your computer.

---

## Where your data lives, and backups

Everything — accounts, invites, projects, version snapshots, git history —
lives in one directory on the server (`QUIRELOOP_DATA_DIR`, `/data` in the
Docker image). **Backing up Quireloop = backing up that one directory.**
See [the server guide](install-server.md) for the backup/restore and upgrade
procedures.

As a user, your personal escape hatches are:

- **Download .zip** on the dashboard — the complete current source of any
  project you can access.
- **Git push** to a remote you control — full history, standard format.

---

## Troubleshooting

**"latexmk not found" / compiles fail with a server error**
The server can't see a TeX installation. This is a server-setup issue —
point the admin at the server guide (in systemd setups, it's almost always the
`PATH=` line missing from the service file).

**A package/font is missing in Docker**
The Docker image ships a curated TeX Live set, not the full 7 GB scheme.
The Dockerfile documents exactly where to add packages; the admin rebuilds
with the extra `texlive-*` package named in the compile error.

**I'm locked out (lost 2FA device)**
An admin with shell access to the server can edit `users.json` in the data
directory and remove your account's `twoFactor` block, then restart the
server. Log in with your password and re-enroll 2FA.

**"Too many attempts" at login**
The rate limiter. Wait the indicated time and try again. If it keeps
happening without failed attempts of your own, someone may be guessing at
your account — tell the admin, and be glad you enabled 2FA.

**The editor says "Offline — changes saved locally"**
Your browser lost its websocket to the server. Your edits are safe in
local storage and will sync when the connection returns. If it persists
while the rest of the site works, the reverse proxy may not be forwarding
websockets — admin: check the `/ws/` block in the nginx config.

**The PDF pane is stale**
Check the Problems list — a compile error means the last *successful* PDF
is still shown. If the log looks fine but output is weird, **Clean Aux
Files** and recompile.

**A shared project disappeared from my dashboard**
The owner unshared it or deleted it. Sharing is live — access ends the
moment it's revoked.

**Signup asks for an invite code but I don't have one**
That's by design: signups are invite-only after the first account. Ask a
- Press **Ctrl/Cmd+K** to search every command and file from one box.
server admin for an invite link.
