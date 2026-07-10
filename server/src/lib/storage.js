import path from 'node:path';
import { PROJECTS_DIR } from '../config.js';

export function projectDir(projectId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    throw new Error(`invalid project id: ${projectId}`);
  }
  return path.join(PROJECTS_DIR, projectId);
}

// Resolves a URL-supplied relative file path against a project's folder,
// throwing if it would escape the project root (e.g. via "../..").
export function resolveProjectPath(projectId, relPath) {
  const base = projectDir(projectId);
  const resolved = path.resolve(base, relPath);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`path escapes project root: ${relPath}`);
  }
  return resolved;
}
