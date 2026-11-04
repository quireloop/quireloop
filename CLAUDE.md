# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo location

The git repository root is `ide/` (this directory), not its parent. The parent
holds an unrelated setup and the `.claude/launch.json` used by preview tooling — `launch.json` must live at
the parent because preview paths resolve from there, which is why its configs
use `--prefix ide/server`.

## Commands

```bash
npm install                        # workspaces: server + web, deps hoist to root
npm run build --workspace=web      # Vite builds INTO server/public/ (gitignored)
cd server && npm start             # serves API + built SPA on :4173
```

Tests (in `server/`):

```bash
npm test                                                        # all suites
node --test test/security.test.js                               # one file
node --test --test-name-pattern "viewer" "test/**/*.test.js"    # one test by name
```

Pass the glob, not a bare `test/` directory — on current Node the directory
form is resolved as a module and fails, which is why `package.json` quotes a
glob.

Development with hot reload needs both processes — `cd server && npm start`
(API on :4173) and `cd web && npm run dev` (UI on :5173, proxying `/api` per
`web/vite.config.js`). Open :5173, not :4173, in this mode.

A LaTeX distribution with `latexmk` and `synctex` on `PATH` is required for
compile; `git` and `unzip` back Source Control and zip import. Nothing is
bundled — the app shells out to the system install. Compile tests skip
themselves when `latexmk` is absent.

## Architecture

**Single port, no database, no build step on the server.** Vite builds the
React app into `server/public/`, and Fastify serves both the API and that SPA
from one origin — so there is no CORS layer and no separate frontend process in
production. All state is plain files under `data/` (gitignored): `users.json`,
`invites.json`, the session key, the two indexes, and `data/projects/<ownerId>/<projectId>/`
holding the user's real `.tex`/`.bib`/image files plus a `manifest.json`.

**Every project directory is its own real git repo**, created on project
creation, entirely separate from this repo's history. Quireloop writes a
`.gitignore` into each one excluding its own bookkeeping (`manifest.json`,
`build/`, `versions/`, the stored remote token), so pushing a project to GitHub
or another git host sends only the paper.

**A project directory can be a symlink.** A member can open a folder that
already exists on the host as a project, edited in place — their own home
directory by default (`library.js:homeForUser`: a PAM account's real UNIX home,
else for local accounts admin-assigned → `<base>/<email local part>` → the
process's own home on a single-account install), plus `QUIRELOOP_LIBRARY_DIRS`.
`data/projects/<ownerId>/<projectId>` is then a link to it
(`manifest.linkedPath` records where). This is deliberately invisible to the
rest of the app — everything still goes through `projectDir()` — but it has
three consequences. `readdir` reports such a slot as a link, not a directory,
so any scan must check `isSymbolicLink()` too (this once hid linked projects
from the dashboard). Deleting one must never recurse into the target: it is the
only path in the app that could destroy a user's own files, and
`manifest.deleteProject` spells the two cases out rather than relying on
`fs.rm`'s behaviour. And `lib/library.js` is the sole gate on which host paths
are reachable — it compares *realpaths* on both sides, because a symlink
planted inside an allowlisted root defeats any string-prefix check.

### The JSON write invariant — read this before touching any state

State is stored as JSON files that get read, mutated, and written back. Doing
that unserialized loses data silently under concurrent requests, and this was a
real measured bug (20 concurrent signups persisted 1 user; 15 concurrent file
saves left 9 of 15 manifest entries). **All such writes must go through
`server/src/lib/jsonStore.js`** — `updateJson` / `updateJsonWithResult` for the
read-modify-write cycle, `withLock` when the mutation spans more than one file
operation, `writeJsonAtomic` for the durable write itself. Never reintroduce a
bare `fs.readFile` → mutate → `fs.writeFile` pair on shared state.

Two consequences worth knowing: `manifest.js` exposes `updateManifest()` and
routes must use it rather than mutating the `req.manifest` read by middleware
(that value is already stale by the time a handler runs); and the locking is
in-process only, so two server processes over one `data/` directory would still
race — a documented non-goal.

### Two kinds of account

`authProvider: 'local'` (email + password + Quireloop's own TOTP) and `'pam'`
(a UNIX account on the host, checked by `deploy/quireloop-pam-auth` — a separate
root-run helper, because the web server is unprivileged and cannot read
`~/.google_authenticator`). Credentials never touch argv: they go to the helper
on stdin, and `lib/pam.js` hands it a narrow env allowlist that **must** include
`PATH`, since the command it runs is `sudo` by name.

The internal `id` stays an opaque nanoid for both. That is deliberate and worth
preserving: the id is a directory name under `data/projects/`, the key of
`shared-index.json`, and the value compared in every `manifest.ownerId` and
`collaborators[].userId`, so making it mean "UNIX username" would require
migrating all of it. A PAM login resolves to a normal user record via
`upsertPamUser`, which must stay inside the `updateJsonWithResult` lock —
without it, concurrent first logins create several accounts for one person
(there's a test that fails when the lock is removed).

### Request pipeline

`src/index.js` exports `buildApp()`; `src/start.js` is what listens. Tests
depend on this split — they drive the real route stack via `app.inject()` with
no port bound.

Auth and access control live in `lib/authMiddleware.js` as `preHandler` chains,
layered: `requireAuth` → `requireProjectAccess` (resolves `:id` to its owner via
the project index, loads the manifest once, decorates `req.ownerId` /
`req.manifest` / `req.projectRole`) → `requireProjectWrite` (rejects viewers) →
`requireProjectOwner`. A URL only ever carries a `projectId`, never the owner,
which is why `projectIndex.json` exists and why losing an entry there makes a
project permanently unreachable.

Every route file declares its own full path (`/api/...`), and `buildApp`
registers them all under `BASE_PATH` so the app can mount at the domain root or
behind a reverse-proxy subpath. The frontend mirror is `web/src/basePath.js`
reading Vite's `BASE_URL`. Changing one without the other breaks subpath
deploys.

### Real-time collaboration

`lib/collab.js` hand-rolls the y-websocket wire protocol (y-websocket v3 ships
no server-side utilities). One `Y.Doc` per `(ownerId, projectId, filePath)`
room, debounce-persisted both to the plain text file — so compile, git and
download keep working off ordinary files — and to a `.bin` CRDT snapshot, which
must be kept: re-seeding a doc from text on restart gives items new ids and
duplicates content for clients holding stale IndexedDB state. `manifest.collabGeneration`
is the room's identity and is bumped on version restore so an in-flight session
can't resurrect pre-restore content.

**A room never writes over an outside edit.** Rooms stay loaded after their
editors leave, so a room's text can be older than its file. Each room remembers
the file's text, time and size as last read or written, and the doc state that
matched it (`room.disk`, `room.baseState`). Before every save, on every
`getRoom`, and every 1.5 s while someone is connected, `checkDisk` compares the
file; an outside change is applied to a fork of `baseState` and merged in, so
browser edits made meanwhile survive alongside it. Disk checks and saves for a
room run one at a time through `serialize`.

### Compile

`lib/latex.js` runs `latexmk` with `-g` (force rebuild) and no `-halt-on-error`,
deliberately: LaTeX usually still emits a usable PDF alongside its errors.
Success is therefore "did a PDF land on disk", never the exit code.
Concurrency is bounded by a global semaphore (half the cores) plus a per-project
lock, since one `build/` directory is shared. Raw logs are parsed into structured
diagnostics by `lib/latexLog.js`. A successful compile auto-snapshots into
version history.

### AI assistant

Per-user and opt-in — each member supplies their own Anthropic key or Ollama
endpoint in Account settings, never a shared lab account. `routes/assistant.js`
resolves the user's own config first and falls back to a server-wide default.
Providers are pluggable under `lib/assistantProviders/`.

## Test harness constraints

`config.js` resolves `QUIRELOOP_DATA_DIR` into module constants at import time,
and an ES module evaluates once per process — so **the unit of isolation is the
test file**, which `node:test` runs in its own process. `test/helpers.js`
memoizes one app per file to enforce this; asking for two data dirs in one file
silently returns the first. Any suite asserting on admin role or signup counts
needs its own file (hence the split `*-concurrency.test.js` files).

The concurrency tests are regressions for measured data loss. To confirm they
still bite, disable `withLock` in `jsonStore.js` and re-run — they should all
fail. Ad-hoc curl loops are a poor substitute here; requests rejected for invite
or rate-limit reasons look identical to lost writes in the persisted count.

## Environment variables

`QUIRELOOP_DATA_DIR` (storage location), `QUIRELOOP_BASE_PATH` /
`VITE_BASE_PATH` (subpath mount, must agree), `QUIRELOOP_OPEN_SIGNUP` (defaults
to invite-only once one user exists; the first account created is always the
admin), `QUIRELOOP_SECURE_COOKIES` (set for TLS deployments),
`QUIRELOOP_USER_HOME_BASE` (where the per-member "your own folder on this host"
convention looks, default `/home`) and `QUIRELOOP_LIBRARY_DIRS` (extra *shared*
directories every member may open projects from),
`QUIRELOOP_ANTHROPIC_API_KEY` / `QUIRELOOP_ASSISTANT_MODEL` /
`QUIRELOOP_OLLAMA_BASE_URL` / `QUIRELOOP_OLLAMA_MODEL` (assistant fallbacks),
`PORT`.

## Conventions

Commits go under the repository owner's name only — no Claude co-author
trailers. The codebase is densely commented with *why*, not *what*, especially
around non-obvious workarounds; match that when editing. License is PolyForm
Noncommercial, so new files should not carry OSI-license headers.

### Offline sync

A personal install can link to a server (`lib/syncClient.js`, `routes/link.js`)
and mirror every paper. Browsers edit only the local copy. Text merges through
Yjs (`POST /api/sync/projects/:id/doc`); other files use a three-way hash
comparison against `.quireloop-sync.json`, and both versions are kept on
conflict. Open files get a live bridge from the local room to the server's room.
Device tokens work only on routes marked `config: { allowDevice: true }`. Two
copies with no shared Yjs history must never be merged, since the text would
double; `sharesHistory` guards this. `test/sync.test.js` runs two real instances
through a relay it can cut.
