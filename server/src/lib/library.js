import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LIBRARY_DIRS } from '../config.js';

// "Library" is the set of host directories an operator has declared browsable,
// so a member can open a folder of .tex files that already exists on the
// server (or on their own machine, running locally) instead of uploading a
// zip or cloning it in. See QUIRELOOP_LIBRARY_DIRS in config.js.
//
// Everything in this file exists to keep that from becoming "read any file on
// the box": a path is usable only if its *realpath* sits inside the realpath
// of a declared root. Resolving symlinks on both sides is the whole point — a
// lexical prefix check would be satisfied by a symlink planted inside a root
// that points at /etc.

export function libraryEnabled() {
  return LIBRARY_DIRS.length > 0;
}

function expand(spec, user) {
  const withHome = spec.startsWith('~/') ? path.join(os.homedir(), spec.slice(2)) : spec;
  return withHome
    .replaceAll('{userId}', user.id)
    // Emails contain characters that are legal in a path but awkward in one;
    // only the local part is stable enough to name a directory.
    .replaceAll('{email}', user.email)
    .replaceAll('{user}', user.email.split('@')[0]);
}

// The roots this particular user may browse, with placeholders expanded and
// each one confirmed to exist — a root that's missing on disk is dropped
// rather than shown as an entry that errors the moment it's clicked.
export async function rootsForUser(user) {
  const roots = [];
  for (const { label, dir } of LIBRARY_DIRS) {
    const expanded = path.resolve(expand(dir, user));
    let real;
    try {
      real = await fs.realpath(expanded);
      if (!(await fs.stat(real)).isDirectory()) continue;
    } catch {
      continue;
    }
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
  if (!libraryEnabled()) {
    throw Object.assign(new Error('opening server folders is not enabled on this server'), { statusCode: 404 });
  }
  if (typeof requestedPath !== 'string' || !requestedPath.trim()) {
    throw Object.assign(new Error('a path is required'), { statusCode: 400 });
  }

  const roots = await rootsForUser(user);
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
