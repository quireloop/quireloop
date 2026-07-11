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
