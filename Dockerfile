# syntax=docker/dockerfile:1
#
# Quireloop container image: a Fastify API + built React frontend, with a
# curated TeX Live install so `latexmk` (pdflatex/xelatex/lualatex) and
# `biber` work out of the box, plus `git`/`unzip` for Source Control and
# project import. See DEPLOYMENT.md for how to run this.

########################################
# Stage 1 — builder: install deps, build the web app
########################################
FROM node:22-bookworm AS builder
WORKDIR /app

# Copy just the manifests first so `npm ci` is cached across rebuilds that
# only touch source, not dependencies. This repo is a single npm workspace
# (root package.json lists ["server", "web"]) with one shared lockfile, so
# `npm ci` at the root installs both workspaces' dependencies in one go —
# there is no per-workspace lockfile to install against individually.
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci

# Now bring in the actual source and build the frontend. web/vite.config.js
# sets `build.outDir: ../server/public`, so this drops the production
# bundle directly where the server's static file handler expects it —
# no separate copy step needed.
COPY server server
COPY web web
RUN npm run build --workspace=web

# Strip devDependencies (vite, @vitejs/plugin-react, etc.) out of the
# hoisted node_modules before it gets copied into the runtime image.
# Note: because this is a single hoisted workspace tree (no nested
# server/node_modules — verified there's no version conflict forcing one),
# `npm prune` operates on the whole tree and will also keep the *web*
# workspace's runtime dependencies (react, codemirror, yjs, pdfjs-dist,
# ...) even though only their already-built static output is served at
# runtime, not their source. Splitting that out cleanly would need a
# separate lockfile per workspace; the waste here is on the order of tens
# of MB, dwarfed by the TeX Live layer below, so it isn't worth the
# fragility of hand-filtering the tree.
RUN npm prune --omit=dev

########################################
# Stage 2 — runtime: TeX Live + Node + the built app
########################################
# Base choice: debian:bookworm-slim + a curated set of TeX Live packages,
# NOT texlive/texlive:latest-full.
#
#   texlive/texlive:latest-full ships every TeX Live scheme (ConTeXt,
#   every language pack, every font collection) — north of 6-7GB, and
#   most of it (ConTeXt, non-Latin language support, exotic fonts) is
#   dead weight for a lab writing LaTeX papers in English/Latin scripts.
#
#   The set below — latex-recommended (pdflatex + core packages),
#   latex-extra (the long tail of commonly-used packages: algorithm2e,
#   todonotes, etc.), fonts-recommended, xetex, luatex, bibtex-extra +
#   biber — covers latexmk with all three engines and modern
#   bibliography (biblatex/biber, not just legacy bibtex) at roughly
#   2-2.5GB. It deliberately excludes texlive-fonts-extra (~1.5GB of
#   additional font families) and texlive-lang-* (non-Latin language
#   support) to keep the image reasonable; if your lab needs either,
#   add the relevant package(s) to the apt-get line below and rebuild.
FROM debian:bookworm-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive

# Node itself: installed via the NodeSource apt repo rather than copying the
# `node` binary out of the builder stage. A bare binary copy would need us
# to also hand-carry every shared library it's dynamically linked against
# (libssl, zlib, ICU, ...) and hope the versions on this slimmer base match
# — fragile, and unverifiable without actually running the image. Pulling
# the `nodejs` .deb through apt instead lets Debian's own dependency
# resolution guarantee those libraries are present and compatible, at the
# cost of one extra apt source + a temporary curl/gnupg install (removed
# again in this same layer so it doesn't add to the final image size).
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
  && mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
  && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
  && apt-get update && apt-get install -y --no-install-recommends nodejs \
  && apt-get purge -y curl gnupg && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y --no-install-recommends \
    texlive-latex-base \
    texlive-latex-recommended \
    texlive-latex-extra \
    texlive-fonts-recommended \
    texlive-xetex \
    texlive-luatex \
    texlive-bibtex-extra \
    biber \
    latexmk \
    git \
    unzip \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Non-root user — the container never needs root once TeX Live is
# installed, and running latexmk/git as an unprivileged user is just
# good hygiene for a process that compiles user-supplied .tex files.
# Fixed uid/gid 1000 (Debian/Ubuntu's usual "first regular user") rather
# than whatever useradd picks next: with a bind-mounted ./data volume
# (docker-compose.yml uses one), the *host* directory's ownership is what
# actually governs write access, not anything chown'd inside the image —
# see DEPLOYMENT.md for the one-time `chown -R 1000:1000 ./data` a
# deployer needs if their host user isn't already uid 1000.
RUN useradd --create-home --home-dir /home/quireloop --uid 1000 --shell /usr/sbin/nologin quireloop

WORKDIR /app
COPY --from=builder --chown=quireloop:quireloop /app/node_modules ./node_modules
COPY --from=builder --chown=quireloop:quireloop /app/server/src ./server/src
COPY --from=builder --chown=quireloop:quireloop /app/server/public ./server/public
COPY --from=builder --chown=quireloop:quireloop /app/server/package.json ./server/package.json

# /data is where everything persistent lives (users.json, invites,
# session key, every project + its git history + version snapshots) —
# see DEPLOYMENT.md's backup section. Mount a volume here.
ENV QUIRELOOP_DATA_DIR=/data
ENV PORT=4173
EXPOSE 4173
VOLUME /data

RUN mkdir -p /data && chown quireloop:quireloop /data
USER quireloop

# No `curl`/`wget` in this image (kept out to avoid another apt layer) —
# Node 22 has a built-in global `fetch`, so the healthcheck shells out to
# node itself instead. Matches GET /api/health added in
# server/src/routes/health.js, which needs no auth/cookie.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
