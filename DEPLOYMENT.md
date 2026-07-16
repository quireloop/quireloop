# Deploying Quireloop for a lab/team

This covers running Quireloop as a shared, multi-user server for a lab or
research group — as opposed to the single-machine, `npm start` setup in the
main [README](README.md). Two paths: Docker (recommended — TeX Live is
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
git clone <this-repo-url> quireloop
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
  `lualatex`, `biber`, and `synctex` on the deploying user's `PATH` — see
  the package list in the `Dockerfile`'s runtime stage for what "full
  enough" means, or just install `texlive-full` if disk space isn't a
  concern.
- **`git` and `unzip`** on `PATH`.

**Build and install:**
```
git clone <this-repo-url> quireloop
cd quireloop
npm ci
npm run build --workspace=web
```

**Run it** directly to sanity-check before wiring up systemd:
```
cd server
QUIRELOOP_DATA_DIR=/var/lib/quireloop/data PORT=4173 node src/index.js
```

**Run it as a service:** copy
[`deploy/quireloop.service.example`](deploy/quireloop.service.example) to
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

[`deploy/nginx.conf.example`](deploy/nginx.conf.example) is a commented
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
| `QUIRELOOP_DATA_DIR` | `<repo>/data` | Where all persistent state lives — accounts, invites, the session-signing key, and every project (with its git history and version snapshots). Docker's image sets this to `/data` and expects a volume mounted there; leave it as the image default rather than overriding it unless you know why you're changing it. |
| `QUIRELOOP_OPEN_SIGNUP` | unset (`false`) | When `true`, signup stays open to anyone who can reach the server, even after the first account exists. Default behavior (unset) is: the very first account can always sign up freely (bootstrapping), and every account after that requires an admin-issued invite code/link. |
| `QUIRELOOP_SECURE_COOKIES` | unset (`false`) | When `true`, the session cookie is set with the `secure` flag, so browsers will only send it over HTTPS. Set this once TLS (e.g. the nginx config above) is actually in front of the server — turning it on without TLS in place will lock everyone out, since the cookie won't be sent back over plain HTTP. |
| `QUIRELOOP_ANTHROPIC_API_KEY` | unset | Enables the built-in AI writing assistant (the ✨ Assistant panel in the editor) with an ops-managed key. **Most installs don't need this** — an admin can paste the key in the UI instead (Admin panel → ✨ Assistant tab; stored in `data/settings.json`, mode 600). When both exist, the env var wins. Get a key at console.anthropic.com; usage is billed to that key, server-wide. With neither set, the assistant is completely off — no button in the UI, no outbound requests. Falls back to `ANTHROPIC_API_KEY` if set. |
| `QUIRELOOP_ASSISTANT_MODEL` | `claude-opus-4-8` | Which Claude model the assistant uses; also settable in the Admin panel (env wins). E.g. `claude-sonnet-5` to trade some quality for lower cost. |

There's no `QUIRELOOP_` variable for the login rate limiter or the compile
engine choice — the rate limiter's thresholds are fixed in
`server/src/lib/rateLimit.js`, and the compile engine (pdflatex/xelatex/
lualatex) is a per-project setting in the UI, not a server-wide one.
