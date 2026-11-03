# Install on a server

This covers running Quireloop as a shared, multi-user server for a lab or
research group. For one person on their own machine, see
[Install on your computer](install-personal.md). Quireloop is licensed for
[academic use only](../README.md#license).

**Steps, in order:**

1. Install with [Docker](#docker-recommended) or on
   [bare metal](#bare-metal-no-docker).
2. Put [HTTPS in front of it](#tls-nginx-in-front-of-either-option).
3. Create the first account (it becomes the admin), and turn on two-factor
   sign-in for it.
4. Invite your lab from the admin panel, or set up
   [server logins](#logging-in-with-server-accounts).
5. Set up backups of the data directory.

Two paths: Docker (recommended — TeX Live is
notoriously fiddly to install correctly, and the image pins a known-good
set of packages) or bare metal (more control, no Docker dependency).

Either way, put TLS in front of it before anyone logs in over the open
internet — see the [nginx section](#tls-nginx-in-front-of-either-option)
below. Logging in submits a password; don't send that over plain HTTP off
of `localhost`.

## Docker (recommended)

**Prerequisites:** Docker + Docker Compose on the host. Nothing else —
Node and TeX Live are both baked into the image.

```
git clone https://github.com/quireloop/quireloop.git
cd quireloop
docker compose up -d --build
```

The first build pulls TeX Live packages and will take a while (and a few
GB of disk — see the size discussion in the `Dockerfile`'s comments) the
first time; rebuilds after that are fast thanks to Docker's layer cache as
long as `package*.json` hasn't changed.

Once it's up, open `http://<this-host>:4173`. **The first account you
create becomes the admin** — there's no separate setup wizard, signup
itself is the setup step. After that first account exists, signup locks
to invite-only automatically; mint invites for the rest of your lab from
the admin panel (the gear/admin icon once logged in as the admin account).
Set `QUIRELOOP_OPEN_SIGNUP=true` (see the [config reference](#configuration-reference)
below) instead if you'd rather leave signup open to anyone who can reach
the server.

**Where your data lives:** everything persistent — accounts, invites, the
session-signing key, and every project (each one its own real git repo,
plus Quireloop's version snapshots) — lives under `./data` next to
`docker-compose.yml`, bind-mounted into the container at `/data`. That
directory *is* the deployment's state; the container itself is disposable.

If your host user isn't uid 1000, one-time fix so the container (which
runs as uid 1000 inside, see the Dockerfile) can write to a fresh
`./data`:
```
mkdir -p data && sudo chown -R 1000:1000 data
```

**Backup:** stop the container (or don't — file writes are per-project
and infrequent enough that a live copy is usually fine for a periodic
backup, though stopping first is safer for a "before I upgrade" snapshot),
then copy `./data` somewhere else. That single directory is the entire
backup — there is no database to dump separately. Restoring is the
reverse: put a saved `data/` back in place and `docker compose up -d`.

**Upgrade:**
```
git pull
docker compose up -d --build
```
This rebuilds the image against your current `./data` (untouched by the
rebuild — it's a bind mount, not baked into the image) and restarts the
container. Take a backup first if the changelog mentions anything data-
format-related.

**TLS:** see [the nginx section](#tls-nginx-in-front-of-either-option)
below — put nginx in front of the container's port 4173 rather than
exposing it directly.

## Bare metal (no Docker)

**Prerequisites:**
- **Node.js 22+**
- **A full TeX Live install** with `latexmk`, `pdflatex`, `xelatex`,
  `lualatex`, `biber`, and `synctex` on the deploying user's `PATH`.
- **`git` and `unzip`** on `PATH`.

**Build and install:**
```
git clone https://github.com/quireloop/quireloop.git
cd quireloop
npm run setup:texlive   # Debian/Ubuntu: apt-get installs latexmk, biber, git, unzip — see below if you're on something else
npm ci
npm run build --workspace=web
```

`npm run setup:texlive` (`scripts/install-texlive.sh`) installs the exact
TeX Live package set the Docker image also uses — enough for
pdflatex/xelatex/lualatex + modern biblatex/biber, without the ~6-7GB of
`texlive-full`. It's Debian/Ubuntu-only (`apt-get`); on another distro,
install the equivalent of `texlive-latex-base`, `texlive-latex-recommended`,
`texlive-latex-extra`, `texlive-science`, `texlive-publishers`,
`texlive-fonts-recommended`, `texlive-xetex`, `texlive-luatex`,
`texlive-bibtex-extra`, `biber`, `latexmk`, `git`, `unzip` yourself
(`texlive-science` covers `algorithm.sty`/`algorithmic.sty`,
`texlive-publishers` covers IEEEtran and other conference/journal
classes — templates needing something more obscure than that will still
need a manually-added package, see the note below), or just run
`texlive-full` if disk space isn't a
concern.

**Run it** directly to sanity-check before wiring up systemd:
```
cd server
QUIRELOOP_DATA_DIR=/var/lib/quireloop/data PORT=4173 node src/start.js
```

**Run it as a service:** copy
[`deploy/quireloop.service.example`](../deploy/quireloop.service.example) to
`/etc/systemd/system/quireloop.service`, edit the `CHANGE-ME` lines (user,
paths, and — importantly — the `PATH` environment line so systemd's
minimal default PATH doesn't hide your TeX Live install from it), then:
```
sudo systemctl daemon-reload
sudo systemctl enable --now quireloop
journalctl -u quireloop -f   # watch it come up
```

**Upgrade:**
```
git pull
npm ci
npm run build --workspace=web
sudo systemctl restart quireloop
```

## TLS: nginx in front of either option

[`deploy/nginx.conf.example`](../deploy/nginx.conf.example) is a commented
reference config: HTTP→HTTPS redirect, a certbot-friendly certificate
path, correct WebSocket upgrade handling for the `/ws/` collaboration
endpoint (with a long read timeout so idle collab sessions aren't cut),
`client_max_body_size 100m` for project zip uploads, and gzip for text
assets. It proxies to `127.0.0.1:4173` regardless of whether that's the
Docker container or the systemd-run process — nginx doesn't care which.

Copy it to `/etc/nginx/sites-available/quireloop`, fill in your domain,
symlink into `sites-enabled`, get a cert (`certbot --nginx -d your.domain`
is the easy path), `nginx -t && systemctl reload nginx`.

Once TLS is live, set `QUIRELOOP_SECURE_COOKIES=true` (Docker: in
`docker-compose.yml`'s `environment:` or a `.env` file; bare metal:
uncomment the line in the systemd unit) so the session cookie gets the
`secure` flag. Leaving it unset over HTTPS still works, just with a
slightly weaker cookie.

## Configuration reference

Every environment variable Quireloop reads, with its default and effect.
Docker: set these in `docker-compose.yml`'s `environment:` block or a
`.env` file next to it. Bare metal: `Environment=` lines in the systemd
unit, or just prefix the `node` command when running manually.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `4173` | TCP port the server listens on. |
| `QUIRELOOP_HOST` | `0.0.0.0` | Address the server listens on. `127.0.0.1` accepts connections from this machine only, which suits a server behind nginx on the same machine. `quireloop start` from pip defaults to `127.0.0.1`. |
| `QUIRELOOP_DATA_DIR` | `<repo>/data` | Where all persistent state lives — accounts, invites, the session-signing key, and every project (with its git history and version snapshots). Docker's image sets this to `/data` and expects a volume mounted there; leave it as the image default rather than overriding it unless you know why you're changing it. |
| `QUIRELOOP_OPEN_SIGNUP` | unset (`false`) | When `true`, signup stays open to anyone who can reach the server, even after the first account exists. Default behavior (unset) is: the very first account can always sign up freely (bootstrapping), and every account after that requires an admin-issued invite code/link. |
| `QUIRELOOP_SECURE_COOKIES` | unset (`false`) | When `true`, the session cookie is set with the `secure` flag, so browsers will only send it over HTTPS. Set this once TLS (e.g. the nginx config above) is actually in front of the server — turning it on without TLS in place will lock everyone out, since the cookie won't be sent back over plain HTTP. |
| `QUIRELOOP_PAM_ENABLED` | unset (`false`) | When `true`, members can log in with **this host's own UNIX accounts** — same username, password and authenticator code as SSH — and their projects live in their real home directory. Requires the auth helper to be installed; see [Logging in with server accounts](#logging-in-with-server-accounts). Email/password accounts keep working alongside it. |
| `QUIRELOOP_PAM_HELPER` | `sudo -n /usr/local/libexec/quireloop-pam-auth` | How to invoke that helper. Change it only to use a different install path or a socket-activated helper instead of sudo. |
| `QUIRELOOP_PAM_EMAIL_DOMAIN` | `localhost` | Sharing and collaborator lists are keyed on email, but a UNIX account has only a username, so Quireloop synthesizes `<username>@<this domain>`. Set it to something recognisable, e.g. your lab's domain. |
| `QUIRELOOP_PAM_SERVICE` | `quireloop` | The PAM service name, i.e. which `/etc/pam.d/` file the login is checked against. Passed through to the helper. |
| `QUIRELOOP_PAM_MIN_UID` | `1000` | Accounts below this uid can never log in, which keeps `root` and every system account out. Passed through to the helper. |
| `QUIRELOOP_PAM_ALLOW_GROUP` | unset | If set, only members of this UNIX group may log in — the simplest way to give a subset of the machine's accounts access. Passed through to the helper. |
| `QUIRELOOP_USER_HOME_BASE` | `/home` (`/Users` on macOS, the folder holding your profile on Windows) | Where the "each member gets their own folder on this host" convention looks: a member with the email `arjun@…` is offered `<base>/arjun` if that directory exists. Only ever grants a member their *own* directory, never the base itself. Overridden per account in Admin panel → Users → Server folder. See [Opening folders already on the server](#opening-folders-already-on-the-server). |
| `QUIRELOOP_LIBRARY_DIRS` | unset | **Shared** host directories, colon-separated, offered to every member on top of their own home — a lab drive, a templates folder. Write a root as `/mnt/latex` or `Label=/mnt/latex`; `{userId}` / `{user}` / `{email}` expand per request. Unlike a member's own home, a plain root here is readable *and writable* by everyone with an account, so keep it narrow. |
| `QUIRELOOP_ANTHROPIC_API_KEY` | unset | Server-wide **fallback** Anthropic key, only used for members who haven't set their own key in Account settings → ✨ AI Assistant. Most installs don't need this — each lab member brings their own pay-as-you-go key (console.anthropic.com), billed to them individually, not to the server. When both this and a stored admin-panel key exist, the env var wins. Falls back to `ANTHROPIC_API_KEY` if set. |
| `QUIRELOOP_ASSISTANT_MODEL` | `claude-opus-4-8` | Model used by the fallback key above; also settable in the Admin panel (env wins). Has no effect on members using their own key — they pick their own model in Account settings. |
| `QUIRELOOP_OLLAMA_BASE_URL` / `QUIRELOOP_OLLAMA_MODEL` | unset | Server-wide fallback pointing at an Ollama instance. Set the address alone and every member can choose from its installed models in the Assistant panel; the model is only an optional default. Can also be set in the Admin panel. |
| `QUIRELOOP_SESSION_DAYS` | `30` | Days a browser stays signed in without being used. Each use renews it. |
| `QUIRELOOP_LANGUAGETOOL_URL` | unset | Address of a LanguageTool server for grammar checking; `scripts/install-languagetool.sh` sets one up privately. Unset hides Grammar check, so text never goes to a checker you didn't choose. |
| `QUIRELOOP_BASE_PATH` | unset (mounts at `/`) | Mounts the API, WebSocket, and static assets under this path prefix instead of the domain root — for sharing one domain across several apps behind a single reverse proxy, e.g. `https://your-domain/quireloop/`. No trailing slash (e.g. `/quireloop`). Must be paired with `VITE_BASE_PATH` below (same value, *with* a trailing slash) at **build time**, not just runtime — Vite bakes the base path into the built JS bundle, so setting `QUIRELOOP_BASE_PATH` alone without rebuilding the frontend against a matching `VITE_BASE_PATH` will serve a bundle that still calls `/api/...` at the root. Docker: set both as `build.args`/`environment` in `docker-compose.yml`. Bare metal: `VITE_BASE_PATH=/quireloop/ npm run build --workspace=web`, then `QUIRELOOP_BASE_PATH=/quireloop` in the systemd unit. |
| `VITE_BASE_PATH` | unset (`/`) | Build-time only (not read at runtime) — see `QUIRELOOP_BASE_PATH` above. |

**Per-user AI assistant, not a shared account:** the ✨ Assistant panel reads
its provider from the logged-in member's own Account settings first
(their own Anthropic key, or their own Ollama server) — the env vars and
Admin panel settings above are only a fallback for members who haven't
configured anything themselves. Nobody's usage gets billed to someone
else's key. **What's not supported:** a personal Claude Pro/Max
subscription (the kind used by Anthropic's own apps) cannot be linked here — that login is restricted by Anthropic
to their own first-party apps. Use a pay-as-you-go API key or Ollama
instead.

## Logging in with server accounts

With `QUIRELOOP_PAM_ENABLED=true`, members sign in with the account they already
have on this machine — the same username, password and authenticator code they'd
use over SSH — and their projects live in their real home directory. No second
set of credentials, no per-account setup, and removing someone's UNIX account
removes their access here.

### Why there's a separate helper

A PAM stack with `pam_google_authenticator` reads each user's
`~/.google_authenticator`, which is mode 0600 and owned by them. Only root can
read all of those. The web server must not be root — so it doesn't do the
checking. `deploy/quireloop-pam-auth` does: a small program whose entire ability
is "here are some credentials, are they valid?". It takes no arguments, runs no
other program, and returns yes or no.

### Install

```bash
# 1. The helper. Root-owned and not writable by the service user — see the
#    warning in the sudoers file about why that matters.
sudo install -o root -g root -m 0755 \
     deploy/quireloop-pam-auth /usr/local/libexec/quireloop-pam-auth

# 2. Which PAM stack the web login uses. Same modules as your sshd setup, but
#    password FIRST and authenticator code SECOND — the order the login form
#    sends them in. sshd's usual order rejects every login (see the file).
#    And don't set NoNewPrivileges in the systemd unit: it breaks the sudo call.
sudo install -o root -g root -m 0644 deploy/quireloop.pam.example /etc/pam.d/quireloop

# 3. Let the service user run the helper, and nothing else.
sudo visudo -f /etc/sudoers.d/quireloop     # paste deploy/quireloop-sudoers.example

# 4. Let Quireloop into members' project folders (see the ownership note below).
sudo setfacl -Rm  u:quireloop:rwx /home/arjun
sudo setfacl -Rdm u:quireloop:rwx /home/arjun
```

Then add to the systemd unit and restart:

```
Environment=QUIRELOOP_PAM_ENABLED=true
Environment=QUIRELOOP_PAM_EMAIL_DOMAIN=yourlab.example
Environment=QUIRELOOP_PAM_ALLOW_GROUP=quireloop-users
```

Check it before handing out the URL — the helper works standalone:

```bash
echo '{"username":"arjun","responses":["<password>","<code>"]}' \
  | sudo -u quireloop sudo -n /usr/local/libexec/quireloop-pam-auth
```

A reply of `{"ok":true,...,"home":"/home/arjun"}` means the whole chain works. On
`{"ok":false}`, the *reason* is on stderr — the reply itself is deliberately the
same for every kind of failure so the web API can't be used to find out who has
an account on this box.

### Who can log in

Only accounts at or above `QUIRELOOP_PAM_MIN_UID` (default 1000), so `root` and
system accounts are refused before PAM is even consulted. Set
`QUIRELOOP_PAM_ALLOW_GROUP` to restrict further to one UNIX group — worth doing
if not everyone with a shell on the machine should have a Quireloop account.
The first person to log in becomes the admin, exactly as with email signup;
after that an admin can disable an account in the Admin panel without touching
the UNIX account.

Members with no UNIX account — an outside co-author, someone at another
institution — still sign up with email and password on the "Email" tab.

### What this does not do

**Files Quireloop writes are owned by the service user, not by the member.**
There is one server process with one uid; it does not become you to touch your
files. So:

- Members' project folders need an ACL letting the service user in (step 4
  above). Without it, a member logs in fine and then can't open anything.
- Files created through the web UI show up as `quireloop`-owned in their home
  directory, group-readable to them.
- **PAM proves who someone is; it does not confine what the process can reach.**
  A member is restricted to their own home directory by Quireloop's checks
  alone — the same boundary as before this feature, now with a real login in
  front of it. Run the service as an unprivileged user, and give it access only
  to the directories that actually need it.

Per-user file ownership would need a worker process per member, running as that
member. That is a much larger change to the storage layer and is not implemented.

## What a compile may touch

Anyone who can edit a project decides what TeX runs, so each compile runs in a
locked-down space built with [bubblewrap](https://github.com/containers/bubblewrap).
Inside it, a compile:

- sees only TeX and the system files it needs, not `/home`, other projects,
  accounts or the login signing key
- can read its own project but write only to `build/`
- has no network and no access to the server's settings or API keys
- stops after 60 seconds, 3 minutes of CPU time, 6 GB of address space, or
  2 GB in any one file

A project's `.latexmkrc` is always ignored, because it is Perl that latexmk
would execute. A paper that needs `\input{../shared}` must keep that file inside
the project, and a link to a file outside the project won't work during a compile.

Install it once, as root:

```bash
sudo bash scripts/install-compile-sandbox.sh
```

Then make it mandatory on any server with more than one user, by adding this to
the systemd unit and restarting:

```
Environment=QUIRELOOP_COMPILE_SANDBOX=required
```

| `QUIRELOOP_COMPILE_SANDBOX` | What happens |
|---|---|
| `auto` (default) | Uses the sandbox if it can run, otherwise warns in the log and compiles without it |
| `required` | Refuses to compile if the sandbox can't run |
| `off` | Never uses it |

**Without the sandbox, any LaTeX engine can read any file the service user can,
and LuaLaTeX can also write to them**, including every project. (TeX Live
2026 stopped honouring the old `openin_any` setting, so nothing else blocks it.) Only run that way when you trust everyone who
can edit. The sandbox usually can't start inside Docker, so a Docker install has
only the container around it, which still holds all the projects.

If TeX is installed outside `/usr`, list its folder in
`QUIRELOOP_COMPILE_SANDBOX_PATHS` (colon-separated). Each project keeps a font
cache in `compile-cache/` in the data directory, and it is safe to delete.

## What the file and git features may touch

Editors work only on the paper. Quireloop's own files (`.git`, `manifest.json`,
`versions/` and `.quireloop*`) can't be read or changed through the interface,
and links that lead outside a project are refused. Git never runs hooks, turns
links into plain files, and is switched off for a folder whose `.git/config`
contains settings that could run a program, such as filters or custom commands.

## Opening folders already on the server

By default a project is something Quireloop creates and stores inside
`QUIRELOOP_DATA_DIR`. The other direction — a paper that already exists on the
host, say at `/home/arjun/Thesis/paper` — is handled by the "Open a Folder…"
button on the dashboard, which opens that directory as a project **in place**.

**This needs no configuration in the common case.** Each member's own home
directory on the host is browsable to them and to nobody else. Quireloop works
out which directory that is in three steps, most explicit first:

1. A folder an admin assigned them in **Admin panel → Users → Server folder**.
2. `<QUIRELOOP_USER_HOME_BASE>/<the email's local part>` — so `arjun@lab.edu`
   gets `/home/arjun` — when that directory exists. The base defaults to
   `/home` (`/Users` on macOS).
3. The server process's own home, but only while this is a one-account
   install; that's what makes running Quireloop on your own laptop work with
   nothing set. It's recorded on the account the first time it applies, so a
   second person signing up doesn't make your folders disappear.

Step 2 is a convention, not a guarantee: if your Quireloop account is
`you@gmail.com` but your papers are under `/home/arjun`, step 2 finds nothing
and the button stays hidden until an admin fills in the Server folder field.
That field takes an absolute path, is validated against the filesystem when
saved, and is the supported way to point an account anywhere non-standard.

`QUIRELOOP_LIBRARY_DIRS` is the separate, *shared* case — a lab drive or common
templates folder that every member should see on top of their own home:

```
QUIRELOOP_LIBRARY_DIRS=Lab drive=/mnt/nvme/latex:Templates=/srv/templates
```

What "in place" means concretely:

- The project slot under `data/projects/` is a **symlink** to your folder.
  Nothing is copied, and edits, uploads and renames in the UI change the real
  files immediately.
- Quireloop writes its own bookkeeping into that folder: `manifest.json`,
  `build/` (so the compiled PDF lands next to your sources), `versions/`, and
  the dotfiles backing comments/chat/collaborative editing. That's deliberate —
  the folder stays self-describing, so you can move it and reopen it later with
  its name and main-file setting intact.
- **Removing** such a project from the dashboard only removes the link. Your
  folder and everything in it is left exactly where it is. This is the one
  place the UI says "Remove" rather than "Delete".
- Quireloop will **not** run `git init` in a folder you already had. If the
  folder is already a git repo, the Source Control panel works normally against
  your existing history.

Two things to know about the boundary on a shared server:

1. **A member reaches their own folder and nothing else.** One member cannot
   browse another's home, and the home *base* (`/home` itself) is not
   browsable — only the specific directory resolved for that account. Anything
   listed in `QUIRELOOP_LIBRARY_DIRS`, by contrast, is readable **and
   writable** by every member with an account, so keep those narrow; the
   `{userId}` / `{user}` / `{email}` placeholders expand per request if you
   want one entry to mean a different directory for each member.
2. **Nothing outside those roots is reachable.** Paths are checked after
   resolving symlinks on both sides, so a link planted inside a root pointing
   at `/etc` is rejected rather than followed, and a path outside the roots
   reports the same "no such folder" as one that doesn't exist.

Note that a member's folder is browsable with the permissions of the **server
process**, not theirs — Quireloop has no unix identity per account. If the
service runs as root, "their home directory" is enforced by Quireloop alone.
Run it as an unprivileged user.

**Security checklist before going live:**
- Set `QUIRELOOP_SECURE_COOKIES=true` once nginx TLS is actually in front (see above) — it's opt-in, easy to forget, and without it the session cookie isn't marked HTTPS-only.
- If this deployment has existing `data/` state from earlier testing, run `chmod 600 data/users.json data/session-key data/invites.json data/share-links.json 2>/dev/null` once — new installs get correct permissions automatically, but files created before this fix don't retroactively tighten.

There's no `QUIRELOOP_` variable for the login rate limiter or the compile
engine choice — the rate limiter's thresholds are fixed in
`server/src/lib/rateLimit.js`, and the compile engine (pdflatex/xelatex/
lualatex) is a per-project setting in the UI, not a server-wide one.
