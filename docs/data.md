# Where your data lives

There are deliberately **two completely separate git histories** at play,
and they never mix:

1. **This repo** (Quireloop's own source code) — what you cloned. It has
   no knowledge of any paper you write with it.
2. **Each project's own repo**, created automatically the moment you make a
   project, living at `data/projects/<id>/`. That folder is *entirely*
   `.gitignore`d by this repo (see the root `.gitignore`),
   so nothing you write ever becomes part of Quireloop's commit
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
