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

// Naive repo discovery — git walking upward from -C dir looking for the
// nearest .git — finds whatever repo the project folder happens to sit inside,
// and any add/commit then silently lands there instead. For a normal project
// that parent is *this app's own repo* (data/ is gitignored inside it); for a
// linked project (see manifest.linkProject) it could be any repo the user
// keeps above their papers folder. GIT_CEILING_DIRECTORIES stops the walk at
// the project's own parent so git can never see above it in either case.
//
// The ceiling has to be the parent of the *real* path: a linked project's
// directory is a symlink, and git resolves it before comparing ancestry, so a
// ceiling naming the symlink's parent would never match. PROJECTS_DIR is kept
// as the fallback for the case where realpath fails.
async function git(dir, args, opts = {}) {
  const ceiling = await fs
    .realpath(dir)
    .then((real) => path.dirname(real))
    .catch(() => PROJECTS_DIR);
  return execa('git', ['-C', dir, ...args], {
    ...opts,
    env: { ...process.env, GIT_CEILING_DIRECTORIES: ceiling, ...opts.env },
  });
}

// Checked directly on disk, never via `git rev-parse` — with ceiling
// directories unset (e.g. before this function's own safety net applies)
// that call would happily report the parent app repo as "the" repo.
export async function hasGitRepo(dir) {
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
  // A merge conflict's "CONFLICT (...)" line is on stdout (it's the merge
  // command's own informational output), not stderr — matching only
  // stderr meant conflicts were falling through to the generic fallback
  // message instead of the dedicated one below.
  const combined = `${err.stdout ?? ''}\n${err.stderr ?? ''}`;
  // Raw git output appended to every message (not just the fallback) so
  // whatever pattern this doesn't anticipate is still visible directly in
  // the Source Control panel's error banner — no server access needed to
  // diagnose an unfamiliar failure.
  const detail = combined
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(' | ');
  const withDetail = (msg) => (detail ? `${msg} [git: ${detail}]` : msg);

  if (/authentication|403/i.test(combined)) return withDetail('authentication failed — check the remote token and try again');
  if (/conflict/i.test(combined)) {
    return withDetail(
      'pull created a merge conflict — open the hosted editor and this project side by side and resolve it there, or in the .tex file directly, then commit and push again'
    );
  }
  if (/rejected|non-fast-forward/i.test(combined)) return withDetail('rejected — pull first to bring in remote changes');
  if (/couldn't find remote ref/i.test(combined)) {
    return withDetail(
      "the remote has no content to pull yet — for the hosted editor, make sure you've opened that project's own Menu → Git panel at least once (that's what provisions its git bridge) and that the URL is exactly https://git.hosted-editor.com/<project id> from that panel, not the regular hosted-editor.com project link"
    );
  }
  if (/repository not found|not found/i.test(combined)) {
    return withDetail("remote repository not found — double check the URL (for the hosted editor: https://git.hosted-editor.com/<project id>, not the regular hosted-editor.com project link)");
  }
  if (err.timedOut) return 'timed out — check the remote URL and your connection';
  return detail || 'git command failed';
}

export async function pushProject(ownerId, projectId) {
  const dir = projectDir(ownerId, projectId);
  await ensureGitRepo(ownerId, projectId);
  const creds = await readCredentials(ownerId, projectId);
  if (!creds) throw new Error('no remote configured yet — set one first');

  const localBranch = await currentBranch(dir);
  const authedUrl = withToken(creds.url, creds.token);

  // Push to whatever branch name the remote actually uses, not whatever
  // the local repo happens to be on — some the hosted editor projects' git bridges
  // are provisioned on "main" rather than "master" (this is what the
  // "wrong branch ... Please use the main branch" rejection means), and
  // pull already resolves the same way. Falls back to the local branch
  // name only when the remote has nothing yet (a genuinely first push),
  // where there's no remote name to defer to.
  let remoteBranch = localBranch;
  try {
    const resolved = await resolveRemoteBranch(authedUrl, localBranch);
    if (resolved.branch) remoteBranch = resolved.branch;
  } catch {
    // Remote unreachable for discovery — fall through and let the push
    // itself surface a clear error instead of failing early here.
  }

  try {
    await git(dir, ['push', '-u', authedUrl, `${localBranch}:${remoteBranch}`], { timeout: PUSH_PULL_TIMEOUT_MS });
  } catch (err) {
    throw new Error(friendlyGitError(err));
  }
  return { ok: true };
}

// Asks the remote what branches it actually has, instead of assuming the
// local branch name applies there too. `pushProject` blindly pushing
// `master:master` still works even if this is wrong (git creates the ref),
// but a wrong assumption here is exactly "couldn't find remote ref X" —
// so pull is worth the extra round trip to get right, and it also means a
// remote that isn't the hosted editor (doesn't use `master`) just works.
async function resolveRemoteBranch(authedUrl, localBranch) {
  const { stdout } = await execa('git', ['ls-remote', '--heads', authedUrl], {
    timeout: PUSH_PULL_TIMEOUT_MS,
  });
  const heads = stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t')[1]?.replace('refs/heads/', ''))
    .filter(Boolean);
  if (heads.length === 0) return { branch: null, heads };
  if (heads.includes(localBranch)) return { branch: localBranch, heads };
  if (heads.includes('master')) return { branch: 'master', heads };
  return { branch: heads[0], heads };
}

export async function pullProject(ownerId, projectId) {
  const dir = projectDir(ownerId, projectId);
  await ensureGitRepo(ownerId, projectId);
  const creds = await readCredentials(ownerId, projectId);
  if (!creds) throw new Error('no remote configured yet — set one first');

  const localBranch = await currentBranch(dir);
  const authedUrl = withToken(creds.url, creds.token);

  let branch;
  try {
    const resolved = await resolveRemoteBranch(authedUrl, localBranch);
    if (!resolved.branch) {
      throw new Error(
        "the remote reports no branches at all — for the hosted editor, open that project's own Menu → Git panel on the hosted editor's site at least once first (that's what provisions its git bridge), and double check the URL is exactly https://git.hosted-editor.com/<project id>"
      );
    }
    branch = resolved.branch;
  } catch (err) {
    if (err.stderr !== undefined) throw new Error(friendlyGitError(err));
    throw err;
  }

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
