import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECTS_DIR } from '../config.js';

function assertSafeId(id, label) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`invalid ${label}: ${id}`);
  }
}

export function userDir(ownerId) {
  assertSafeId(ownerId, 'user id');
  return path.join(PROJECTS_DIR, ownerId);
}

export function projectDir(ownerId, projectId) {
  assertSafeId(projectId, 'project id');
  return path.join(userDir(ownerId), projectId);
}

// Resolves a URL-supplied relative file path against a project's folder,
// throwing if it would escape the project root (e.g. via "../..").
export function resolveProjectPath(ownerId, projectId, relPath) {
  const base = projectDir(ownerId, projectId);
  const resolved = path.resolve(base, relPath);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`path escapes project root: ${relPath}`);
  }
  return resolved;
}

// Quireloop's own files, which share the project folder with the paper. They
// hold what decides who may do what: git's config can name programs for the
// server to run, the manifest lists the owner, and one file holds the git token.
const PRIVATE_ENTRY = /^(\.git|manifest\.json|versions|\.quireloop[^/]*)(\/|$)/;

export function isPrivatePath(relPath) {
  return PRIVATE_ENTRY.test(relPath.split(path.sep).join('/').toLowerCase());
}

// Where a real path may be, once links are followed. A link can arrive through
// a git pull or be left by a compile, and pointing one at the session key must
// not make that file readable, so this checks the deepest part that exists.
export async function assertInsideRoot(root, target) {
  const realRoot = await fs.realpath(root);
  let existing = target;
  for (;;) {
    const real = await fs.realpath(existing).catch((err) => {
      if (err.code === 'ENOENT') return null;
      throw err;
    });
    if (real !== null) {
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
        throw new Error('path leaves the project folder');
      }
      return;
    }
    // realpath can't follow a dangling link, so stop rather than walk past it.
    const stat = await fs.lstat(existing).catch(() => null);
    if (stat?.isSymbolicLink()) throw new Error('path leaves the project folder');
    existing = path.dirname(existing);
  }
}

// What anything driven by a request must use. resolveProjectPath alone only
// compares text, and is for paths the server chose itself.
export async function resolveUserPath(ownerId, projectId, relPath) {
  const base = projectDir(ownerId, projectId);
  const resolved = resolveProjectPath(ownerId, projectId, relPath);
  const relative = path.relative(base, resolved);
  if (!relative || isPrivatePath(relative)) {
    throw new Error(`that path is not available: ${relPath}`);
  }
  await assertInsideRoot(base, resolved);
  return resolved;
}
