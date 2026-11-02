import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { walkFiles } from './manifest.js';
import { projectDir, isPrivatePath } from './storage.js';

// What both ends of a sync agree on about files. The two must never disagree
// here, or one side would keep deleting what the other keeps sending.

export const MAX_SYNC_FILE_BYTES = 100 * 1024 * 1024;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  '.tex', '.bib', '.cls', '.sty', '.bst', '.bbx', '.cbx', '.def', '.cfg', '.txt', '.md', '.csv',
]);

// Text merges character by character. Everything else is copied whole.
function isMergeableText(relPath, buffer) {
  if (!TEXT_EXTENSIONS.has(path.extname(relPath).toLowerCase())) return false;
  if (buffer.length > MAX_TEXT_BYTES) return false;
  return Buffer.from(buffer.toString('utf8'), 'utf8').equals(buffer);
}

// Never trusted from the other side: a server could name a path in a hidden
// file or the compile output as easily as a laptop could.
export function isSyncablePath(relPath) {
  if (typeof relPath !== 'string' || !relPath || relPath.includes('\0') || relPath.includes('\\')) return false;
  if (isPrivatePath(relPath)) return false;
  const parts = relPath.split('/');
  if (parts[0] === 'build') return false;
  return parts.every((part) => part && !part.startsWith('.') && part !== '__MACOSX');
}

const hashCache = new Map(); // full path -> { size, mtimeMs, entry }

async function describeFile(fullPath, relPath, stat) {
  const cached = hashCache.get(fullPath);
  if (cached?.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.entry;
  const buffer = await fs.readFile(fullPath);
  const entry = {
    path: relPath,
    size: buffer.length,
    sha256: sha256(buffer),
    text: isMergeableText(relPath, buffer),
  };
  hashCache.set(fullPath, { size: stat.size, mtimeMs: stat.mtimeMs, entry });
  return entry;
}

export function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// The paper's real files. Links are left out so a link in a project can't send
// what it points at, and oversized files are named so they can be reported.
export async function listSyncFiles(ownerId, projectId) {
  const dir = projectDir(ownerId, projectId);
  const files = [];
  const tooLarge = [];
  for (const relPath of await walkFiles(dir)) {
    if (!isSyncablePath(relPath)) continue;
    const fullPath = path.join(dir, relPath);
    const stat = await fs.lstat(fullPath).catch(() => null);
    if (!stat?.isFile()) continue;
    if (stat.size > MAX_SYNC_FILE_BYTES) {
      tooLarge.push(relPath);
      continue;
    }
    files.push(await describeFile(fullPath, relPath, stat));
  }
  return { files, tooLarge };
}
