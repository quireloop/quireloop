import fs from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { projectDir } from './storage.js';
import { PROJECTS_DIR } from '../config.js';
import { withToken, withoutToken } from './gitAuth.js';

const PUSH_PULL_TIMEOUT_MS = 60_000;
const CREDENTIALS_FILE = '.quireloop-remote.json';

// Commits in a project's git history are attributed to this fixed identity
// unless the user has their own global git config — set explicitly on
// every commit so it works out of the box on a machine with no git config
// at all, rather than failing with "please tell me who you are".
const GIT_IDENTITY = ['-c', 'user.name=Quireloop', '-c', 'user.email=quireloop@localhost'];

// Quireloop's own bookkeeping — never part of the paper, never pushed.
const GITIGNORE_CONTENT = `# Quireloop bookkeeping — not part of your project
/manifest.json
/build/
/versions/
/${CREDENTIALS_FILE}
.quireloop-ydoc/
.quireloop-comments.json
.quireloop-suggestions.json
.quireloop-chat.json
.DS_Store
`;

// Every project directory lives under PROJECTS_DIR (<ownerId>/<projectId>),
// which itself lives inside this app's own repo (as gitignored data), so
// naive repo discovery (git walking upward from -C dir looking for the
// nearest .git) finds *this app's* repo, not a project-local one — and any
// add/commit then silently lands there instead. GIT_CEILING_DIRECTORIES
// stops that walk at PROJECTS_DIR, so git can never see anything above a
// given project folder, no matter what.
function git(dir, args, opts = {}) {
  return execa('git', ['-C', dir, ...args], {
    ...opts,
    env: { ...process.env, GIT_CEILING_DIRECTORIES: PROJECTS_DIR, ...opts.env },
  });
}

// Checked directly on disk, never via `git rev-parse` — with ceiling
// directories unset (e.g. before this function's own safety net applies)
// that call would happily report the parent app repo as "the" repo.
async function hasGitRepo(dir) {
  try {
    const stat = await fs.stat(path.join(dir, '.git'));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

// the hosted editor's git bridge only ever recognizes a `master` ref — but a plain
// `git init` picks up whatever branch name the host's git defaults to
// (`main` on any git 2.28+ with the now-common default), so pushes/pulls
// against the hosted editor were silently talking to the wrong ref. Runs on every
// ensureGitRepo call (cheap no-op once already on master) so it also
// self-heals projects that were already created before this fix, without
// needing a manual migration step.
async function normalizeBranch(dir) {
  // Not currentBranch()/`rev-parse --abbrev-ref HEAD` — that fails on an
  // unborn branch (fresh `git init`, no commit yet), which is exactly the
  // case a brand-new project hits here. `symbolic-ref` just reads the ref
  // file, so it works whether or not HEAD has ever pointed at a commit.
  const branch = await git(dir, ['symbolic-ref', '--short', 'HEAD'])
    .then((r) => r.stdout.trim())
    .catch(() => '');
  if (!branch || branch === 'master') return;
  const hasCommit = await git(dir, ['rev-parse', '--verify', 'HEAD'])
    .then(() => true)
    .catch(() => false);
  if (hasCommit) {
    await git(dir, ['branch', '-m', branch, 'master']).catch(() => {});
  } else {
    // Fresh `git init`, no commits yet (unborn branch) — just repoint HEAD.
    await git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/master']);
  }
}

// Idempotent: turns a project folder into a git repo if it isn't one yet,
// and makes sure our own bookkeeping files are ignored. Safe to call before
// every git operation — a no-op if already set up.
//
// The very first call also makes an initial commit of whatever's already on
// disk, so the repo doesn't start out "empty" (no HEAD, nothing to diff
// against). Every later call must NOT auto-commit — this runs on every
// status check, so if it kept committing "whatever's pending" the user's
// in-progress edits would get swallowed under a meaningless message before
// they ever reach the commit box in the UI.
export async function ensureGitRepo(ownerId, projectId) {
  const dir = projectDir(ownerId, projectId);
  const ignorePath = path.join(dir, '.gitignore');
  const isNewRepo = !(await hasGitRepo(dir));

  if (isNewRepo) {
    await git(dir, ['init']);
  }

  try {
    await fs.access(ignorePath);
  } catch {
    await fs.writeFile(ignorePath, GITIGNORE_CONTENT);
  }

  await normalizeBranch(dir);

  if (!isNewRepo) return;

  const status = await git(dir, ['status', '--porcelain']);
  if (status.stdout.trim()) {
    await git(dir, [...GIT_IDENTITY, 'add', '-A']);
    await git(dir, [...GIT_IDENTITY, 'commit', '-m', 'Initial commit']);
  }
}

function parseStatusLine(line) {
  const status = line.slice(0, 2);
  let filePath = line.slice(3);
  if (status[0] === 'R' || status[0] === 'C') {
    filePath = filePath.split(' -> ')[1] ?? filePath;
  }
  return { path: filePath, status: status.trim() || '??' };
}

export async function gitStatus(ownerId, projectId) {
  const dir = projectDir(ownerId, projectId);
  await ensureGitRepo(ownerId, projectId);

  const { stdout } = await git(dir, ['status', '--porcelain', '-b']);
  const lines = stdout.split('\n').filter(Boolean);
  const branchLine = lines[0] ?? '';
  const files = lines.slice(1).map(parseStatusLine);

  const branchMatch = branchLine.match(/^## ([^.\s]+)/);
  const branch = branchMatch?.[1] ?? 'main';
  const ahead = Number(branchLine.match(/ahead (\d+)/)?.[1] ?? 0);
  const behind = Number(branchLine.match(/behind (\d+)/)?.[1] ?? 0);
  const hasUpstream = branchLine.includes('...');

  const remote = await getRemote(ownerId, projectId);

  return { branch, ahead, behind, hasUpstream, remote, files };
}

export async function gitCommit(ownerId, projectId, message) {
  const dir = projectDir(ownerId, projectId);
  await ensureGitRepo(ownerId, projectId);

  const status = await git(dir, ['status', '--porcelain']);
  if (!status.stdout.trim()) {
    return { ok: true, committed: false };
  }

  await git(dir, [...GIT_IDENTITY, 'add', '-A']);
  await git(dir, [...GIT_IDENTITY, 'commit', '-m', message?.trim() || 'Update']);
  return { ok: true, committed: true };
}

function credentialsPath(ownerId, projectId) {
  return path.join(projectDir(ownerId, projectId), CREDENTIALS_FILE);
}

async function readCredentials(ownerId, projectId) {
  try {
    const raw = await fs.readFile(credentialsPath(ownerId, projectId), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function getRemote(ownerId, projectId) {
  const creds = await readCredentials(ownerId, projectId);
  return creds ? withoutToken(creds.url) : null;
}

export async function setRemote(ownerId, projectId, url, token) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("that doesn't look like a valid URL");
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('only https:// git URLs are supported');
  }

  await ensureGitRepo(ownerId, projectId);
  const dir = projectDir(ownerId, projectId);

  // The token lives only in this gitignored file — never in .git/config —
  // so it can't leak if the repo is inspected or copied elsewhere.
  const plainUrl = withoutToken(url);
  await fs.writeFile(credentialsPath(ownerId, projectId), JSON.stringify({ url: plainUrl, token }, null, 2), {
    mode: 0o600,
  });

  await git(dir, ['remote', 'remove', 'origin']).catch(() => {});
  await git(dir, ['remote', 'add', 'origin', plainUrl]);

  return { url: plainUrl };
}

async function currentBranch(dir) {
  const { stdout } = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return stdout.trim();
}

function friendlyGitError(err) {
  const stderr = err.stderr ?? '';
  if (/authentication|403/i.test(stderr)) return 'authentication failed — check the remote token and try again';
  if (/rejected|non-fast-forward/i.test(stderr)) return 'rejected — pull first to bring in remote changes';
  if (/conflict/i.test(stderr)) {
    return 'pull created a merge conflict — open the hosted editor and this project side by side and resolve it there, or in the .tex file directly, then commit and push again';
  }
  if (/couldn't find remote ref/i.test(stderr)) {
    return "the remote has no content to pull yet — for the hosted editor, make sure you've opened that project's own Menu → Git panel at least once (that's what provisions its git bridge) and that the URL is exactly https://git.hosted-editor.com/<project id> from that panel, not the regular hosted-editor.com project link";
  }
  if (/repository not found|not found/i.test(stderr)) {
    return "remote repository not found — double check the URL (for the hosted editor: https://git.hosted-editor.com/<project id>, not the regular hosted-editor.com project link)";
  }
  if (err.timedOut) return 'timed out — check the remote URL and your connection';
  return stderr.split('\n').find(Boolean) || 'git command failed';
}

export async function pushProject(ownerId, projectId) {
  const dir = projectDir(ownerId, projectId);
  await ensureGitRepo(ownerId, projectId);
  const creds = await readCredentials(ownerId, projectId);
  if (!creds) throw new Error('no remote configured yet — set one first');

  const branch = await currentBranch(dir);
  const authedUrl = withToken(creds.url, creds.token);
  try {
    await git(dir, ['push', '-u', authedUrl, `${branch}:${branch}`], { timeout: PUSH_PULL_TIMEOUT_MS });
  } catch (err) {
    throw new Error(friendlyGitError(err));
  }
  return { ok: true };
}

export async function pullProject(ownerId, projectId) {
  const dir = projectDir(ownerId, projectId);
  await ensureGitRepo(ownerId, projectId);
  const creds = await readCredentials(ownerId, projectId);
  if (!creds) throw new Error('no remote configured yet — set one first');

  const branch = await currentBranch(dir);
  const authedUrl = withToken(creds.url, creds.token);
  try {
    // --allow-unrelated-histories: a project connected to an existing
    // the hosted editor project after already having local commits (the normal
    // case — Quireloop auto-commits a new project's template files the
    // first time git touches it) has no shared ancestry with the the hosted editor
    // side, so a plain `git pull` refuses to merge at all. Safe to pass
    // unconditionally — it's a no-op when the histories *do* share an
    // ancestor (e.g. after "Import from the hosted editor", a real `git clone`).
    await git(dir, ['pull', '--no-rebase', '--allow-unrelated-histories', authedUrl, branch], {
      timeout: PUSH_PULL_TIMEOUT_MS,
    });
  } catch (err) {
    throw new Error(friendlyGitError(err));
  }
  return { ok: true };
}
