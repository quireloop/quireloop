import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { projectDir } from './storage.js';
import { readManifest, writeManifest } from './manifest.js';

const MAX_AUTO_SNAPSHOTS = 20;
const SKIP_ENTRIES = new Set(['build', 'versions']);

// Same idea as manifest.js's BOOKKEEPING_ENTRIES/walkFiles — a snapshot is a
// full copy of the project tree (see copyProjectContents), so it carries
// manifest.json along with it; that's Quireloop's own bookkeeping, never a
// project file to list or diff.
const SNAPSHOT_BOOKKEEPING_ENTRIES = new Set(['manifest.json']);

// Extensions treated as binary — not worth listing for a text diff view.
// Mirrors search.js's BINARY_EXTS (kept separate since that's a route file).
const BINARY_EXTS = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.zip',
  '.gz',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.ico',
]);

function isBinaryPath(relPath) {
  const ext = path.extname(relPath).toLowerCase();
  return BINARY_EXTS.has(ext);
}

function versionsDir(ownerId, projectId) {
  return path.join(projectDir(ownerId, projectId), 'versions');
}

function assertSafeVersionId(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`invalid version id: ${id}`);
  }
}

async function walkTextFiles(root, base = '') {
  const entries = await fs.readdir(path.join(root, base), { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue;
    if (!base && SNAPSHOT_BOOKKEEPING_ENTRIES.has(entry.name)) continue;
    const relPath = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files = files.concat(await walkTextFiles(root, relPath));
    } else {
      if (isBinaryPath(relPath)) continue;
      files.push(relPath);
    }
  }
  return files;
}

// Lists the text files present in a saved snapshot, for the version diff
// view's file picker. Throws if the version id isn't a known snapshot.
export async function listSnapshotFiles(ownerId, projectId, versionId) {
  assertSafeVersionId(versionId);
  const index = await readIndex(ownerId, projectId);
  if (!index.some((v) => v.id === versionId)) {
    throw new Error('version not found');
  }
  return walkTextFiles(path.join(versionsDir(ownerId, projectId), versionId));
}

// Resolves a URL-supplied relative file path against a version snapshot's
// folder, same containment check as storage.js's resolveProjectPath —
// throws if it would escape the snapshot root (e.g. via "../..").
export function resolveSnapshotFilePath(ownerId, projectId, versionId, relPath) {
  assertSafeVersionId(versionId);
  const base = path.join(versionsDir(ownerId, projectId), versionId);
  const resolved = path.resolve(base, relPath);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`path escapes version root: ${relPath}`);
  }
  return resolved;
}

function indexPath(ownerId, projectId) {
  return path.join(versionsDir(ownerId, projectId), 'index.json');
}

async function readIndex(ownerId, projectId) {
  try {
    return JSON.parse(await fs.readFile(indexPath(ownerId, projectId), 'utf8'));
  } catch {
    return [];
  }
}

async function writeIndex(ownerId, projectId, index) {
  await fs.mkdir(versionsDir(ownerId, projectId), { recursive: true });
  await fs.writeFile(indexPath(ownerId, projectId), JSON.stringify(index, null, 2));
}

async function copyProjectContents(fromDir, toDir) {
  await fs.mkdir(toDir, { recursive: true });
  const entries = await fs.readdir(fromDir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_ENTRIES.has(entry.name)) continue;
    await fs.cp(path.join(fromDir, entry.name), path.join(toDir, entry.name), { recursive: true });
  }
}

// Snapshots are full copies of the project tree (manifest.json included) —
// simple and correct, at the cost of some disk space. Auto-snapshots
// (trigger: 'compile') are pruned to the most recent MAX_AUTO_SNAPSHOTS;
// manual and pre-restore safety-net snapshots are kept forever.
export async function createSnapshot(ownerId, projectId, { label, trigger }) {
  const id = nanoid(10);
  await copyProjectContents(projectDir(ownerId, projectId), path.join(versionsDir(ownerId, projectId), id));

  const index = await readIndex(ownerId, projectId);
  index.push({ id, label: label || null, trigger, createdAt: new Date().toISOString() });

  if (trigger === 'compile') {
    const autos = index.filter((v) => v.trigger === 'compile');
    if (autos.length > MAX_AUTO_SNAPSHOTS) {
      const toRemove = autos.slice(0, autos.length - MAX_AUTO_SNAPSHOTS);
      for (const v of toRemove) {
        await fs.rm(path.join(versionsDir(ownerId, projectId), v.id), { recursive: true, force: true });
      }
      const removeIds = new Set(toRemove.map((v) => v.id));
      await writeIndex(ownerId, projectId, index.filter((v) => !removeIds.has(v.id)));
      return { id, label, trigger };
    }
  }

  await writeIndex(ownerId, projectId, index);
  return { id, label, trigger };
}

export async function listVersions(ownerId, projectId) {
  const index = await readIndex(ownerId, projectId);
  return index.slice().reverse();
}

export async function restoreVersion(ownerId, projectId, versionId) {
  const index = await readIndex(ownerId, projectId);
  const target = index.find((v) => v.id === versionId);
  if (!target) throw new Error('version not found');

  // Safety net: the current (about-to-be-overwritten) state is itself
  // snapshotted first, so a restore is always reversible.
  await createSnapshot(ownerId, projectId, { label: 'Before restore', trigger: 'restore' });

  const dir = projectDir(ownerId, projectId);
  const src = path.join(versionsDir(ownerId, projectId), versionId);

  const currentEntries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of currentEntries) {
    if (SKIP_ENTRIES.has(entry.name)) continue;
    await fs.rm(path.join(dir, entry.name), { recursive: true, force: true });
  }
  await copyProjectContents(src, dir);

  // Bump updatedAt (dashboard) and collabGeneration — the latter changes the
  // room identity every live editor uses, so a restore can't be silently
  // undone by an in-flight collaborative session resurrecting pre-restore
  // content (see collab.invalidateProject, called by the route after this).
  const manifest = await readManifest(ownerId, projectId);
  manifest.collabGeneration = (manifest.collabGeneration ?? 0) + 1;
  await writeManifest(ownerId, projectId, manifest);
  return { ok: true };
}
