import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LIBRARY_DIRS, USER_HOME_BASE } from '../config.js';
import { listUsers, updateUser } from './auth.js';

// "Library" is the set of host directories a member may browse, so they can
// open a folder of .tex files that already exists on the server (or on their
// own machine, running locally) instead of uploading a zip or cloning it in.
//
// Each member's own home directory on the host is a root automatically — that
// is the case this exists for, and it needs no configuration. Anything beyond
// their own home is opt-in: QUIRELOOP_LIBRARY_DIRS for shared directories, or
// an admin assigning a member an explicit home.
//
// The rest of this file exists to keep that from becoming "read any file on
// the box": a path is usable only if its *realpath* sits inside the realpath
// of one of that user's roots. Resolving symlinks on both sides is the whole
// point — a lexical prefix check would be satisfied by a symlink planted
// inside a root that points at /etc.

function expand(spec, user) {
  const withHome = spec.startsWith('~/') ? path.join(os.homedir(), spec.slice(2)) : spec;
  return withHome
    .replaceAll('{userId}', user.id)
    // Emails contain characters that are legal in a path but awkward in one;
    // only the local part is stable enough to name a directory.
    .replaceAll('{email}', user.email)
    .replaceAll('{user}', user.email.split('@')[0]);
}

async function isDirectory(p) {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

// Which directory on the host belongs to this member. There is no inherent
// link between a Quireloop account and a unix user, so this is three rules in
// descending order of explicitness:
//
//   1. A path an admin assigned to them (Admin panel → Server folder). The
//      escape hatch for when the convention doesn't hold — an account whose
//      email is nothing like its unix username, or papers kept off /home.
//   2. <USER_HOME_BASE>/<email local part>, the convention on a server where
//      accounts mirror unix users. Skipped silently if it isn't a directory.
//   3. The server process's own home, but only when this is a single-account
//      install — then the app and the person really are the same user, which
//      is what makes running Quireloop on your own laptop work out of the box.
//      With two accounts that inference is wrong, so it stops applying.
export async function homeForUser(user) {
  if (user.homeDir) {
    return (await isDirectory(user.homeDir)) ? user.homeDir : null;
  }

  const localPart = user.email.split('@')[0];
  // A '/' or '..' smuggled through an email would build a path outside the
  // base; basename can't escape it.
  const byConvention = path.join(USER_HOME_BASE, path.basename(localPart));
  if (await isDirectory(byConvention)) return byConvention;

  const users = await listUsers();
  if (users.length === 1 && users[0].id === user.id) {
    const processHome = os.homedir();
    if (await isDirectory(processHome)) {
      // Recorded rather than re-inferred, so it survives a second person
      // signing up — otherwise the sole user's folders would quietly vanish
      // from the dashboard the moment the install stopped being single-user.
      // It shows up in the Admin panel as an explicit value from then on, and
      // can be cleared there.
      await updateUser(user.id, { homeDir: processHome }).catch(() => {});
      return processHome;
    }
  }
  return null;
}

// The roots this particular user may browse, with placeholders expanded and
// each one confirmed to exist — a root that's missing on disk is dropped
// rather than shown as an entry that errors the moment it's clicked.
export async function rootsForUser(user) {
  const roots = [];

  const home = await homeForUser(user);
  if (home) {
    const real = await fs.realpath(home).catch(() => null);
    if (real) roots.push({ label: 'Your files', path: home, realPath: real });
  }

  for (const { label, dir } of LIBRARY_DIRS) {
    const expanded = path.resolve(expand(dir, user));
    let real;
    try {
      real = await fs.realpath(expanded);
      if (!(await fs.stat(real)).isDirectory()) continue;
    } catch {
      continue;
    }
    // A shared root that resolves to somewhere already covered (typically the
    // user's own home) would show up as a duplicate entry to click on.
    if (roots.some((r) => r.realPath === real)) continue;
    roots.push({ label: expand(label, user), path: expanded, realPath: real });
  }
  return roots;
}

function contains(parent, child) {
  return child === parent || child.startsWith(parent + path.sep);
}

// Resolves a client-supplied absolute path to a real directory inside one of
// the user's roots, or throws. Every library route funnels through this.
export async function resolveInLibrary(user, requestedPath) {
  if (typeof requestedPath !== 'string' || !requestedPath.trim()) {
    throw Object.assign(new Error('a path is required'), { statusCode: 400 });
  }

  const roots = await rootsForUser(user);
  if (roots.length === 0) {
    throw Object.assign(
      new Error("there are no server folders you can open — ask an admin to set your account's server folder"),
      { statusCode: 404 }
    );
  }
  let real;
  try {
    real = await fs.realpath(path.resolve(requestedPath));
  } catch {
    throw Object.assign(new Error('no such folder'), { statusCode: 404 });
  }

  const root = roots.find((r) => contains(r.realPath, real));
  if (!root) {
    // Deliberately the same message as a missing folder: whether a path
    // outside the allowlist exists is itself information worth withholding.
    throw Object.assign(new Error('no such folder'), { statusCode: 404 });
  }
  if (!(await fs.stat(real)).isDirectory()) {
    throw Object.assign(new Error('that is a file, not a folder'), { statusCode: 400 });
  }
  return { realPath: real, root };
}

const TEX_EXTENSIONS = new Set(['.tex', '.bib', '.cls', '.sty', '.bst']);

// One directory's immediate children — subfolders (to descend into) and a
// count of the LaTeX-ish files in it, which is what tells the user at a glance
// whether this is the folder holding their paper.
export async function listDirectory(user, requestedPath) {
  const { realPath, root } = await resolveInLibrary(user, requestedPath);
  const entries = await fs.readdir(realPath, { withFileTypes: true });

  const folders = [];
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(realPath, entry.name);
    // A symlink reports neither isDirectory() nor isFile(), so classify by
    // what it points at — but only if it still resolves inside the root.
    let isDir = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      try {
        const target = await fs.realpath(full);
        if (!contains(root.realPath, target)) continue;
        const stat = await fs.stat(full);
        isDir = stat.isDirectory();
        isFile = stat.isFile();
      } catch {
        continue; // broken link
      }
    }
    if (isDir) folders.push({ name: entry.name, path: full });
    else if (isFile) files.push(entry.name);
  }

  folders.sort((a, b) => a.name.localeCompare(b.name));
  const texFiles = files.filter((n) => TEX_EXTENSIONS.has(path.extname(n).toLowerCase()));

  return {
    path: realPath,
    // Null at a root, so the UI knows not to offer "up" out of the allowlist.
    parent: realPath === root.realPath ? null : path.dirname(realPath),
    rootPath: root.realPath,
    rootLabel: root.label,
    folders,
    texFiles: texFiles.sort(),
    fileCount: files.length,
    isGitRepo: entries.some((e) => e.name === '.git'),
  };
}
