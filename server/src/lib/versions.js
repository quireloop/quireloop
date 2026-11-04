import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { PROJECTS_INDEX_FILE } from '../config.js';
import { assertInsideRoot, isPrivatePath, projectDir } from './storage.js';
import { updateManifest } from './manifest.js';
import { readJson, updateJson } from './jsonStore.js';

const MAX_AUTO_SNAPSHOTS = 20;
// Autosaves hold only the writing, so many are cheap: a few kilobytes each.
const MAX_AUTOSAVES = 200;
const AUTOSAVE_INTERVAL_MS = 60_000;
// Larger files are data or media, not writing, and stay out of autosaves.
const MAX_AUTOSAVE_FILE_BYTES = 1024 * 1024;
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
export async function resolveSnapshotFilePath(ownerId, projectId, versionId, relPath) {
  assertSafeVersionId(versionId);
  const base = path.join(versionsDir(ownerId, projectId), versionId);
  const resolved = path.resolve(base, relPath);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`path escapes version root: ${relPath}`);
  }
  if (isPrivatePath(path.relative(base, resolved))) {
    throw new Error(`that path is not available: ${relPath}`);
  }
  await assertInsideRoot(base, resolved);
  return resolved;
}

function indexPath(ownerId, projectId) {
  return path.join(versionsDir(ownerId, projectId), 'index.json');
}

async function readIndex(ownerId, projectId) {
  return readJson(indexPath(ownerId, projectId), []);
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

  // Two collaborators compiling at once both land here; without the lock the
  // second write drops the first's snapshot from the index, orphaning its
  // on-disk copy and losing it from version history.
  await updateJson(indexPath(ownerId, projectId), [], async (current) => {
    const index = [...current, { id, label: label || null, trigger, createdAt: new Date().toISOString() }];
    if (trigger !== 'compile') return index;

    const autos = index.filter((v) => v.trigger === 'compile');
    if (autos.length <= MAX_AUTO_SNAPSHOTS) return index;

    const toRemove = autos.slice(0, autos.length - MAX_AUTO_SNAPSHOTS);
    for (const v of toRemove) {
      await fs.rm(path.join(versionsDir(ownerId, projectId), v.id), { recursive: true, force: true });
    }
    const removeIds = new Set(toRemove.map((v) => v.id));
    return index.filter((v) => !removeIds.has(v.id));
  });
  return { id, label, trigger };
}

// The project's writing: its text files, leaving out Quireloop's own folders,
// hidden files and anything large. Paths use '/' on every system.
async function walkWriting(root, base = '') {
  const entries = await fs.readdir(path.join(root, base), { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue;
    if (!base && (SKIP_ENTRIES.has(entry.name) || SNAPSHOT_BOOKKEEPING_ENTRIES.has(entry.name))) continue;
    const relPath = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files = files.concat(await walkWriting(root, relPath));
    } else if (entry.isFile() && !isBinaryPath(relPath)) {
      files.push(relPath);
    }
  }
  return files;
}

// What each project's writing looked like at the last check, by file times
// and sizes, so an unchanged project costs a directory listing, not a read.
const lastSeen = new Map(); // projectId -> stat key

// Saves a text-only version if the writing changed since the last autosave,
// whether it was edited in Quireloop or by any other program, compiled or not.
export async function autosaveIfChanged(ownerId, projectId) {
  const dir = projectDir(ownerId, projectId);
  const files = [];
  for (const relPath of (await walkWriting(dir)).sort()) {
    const stat = await fs.stat(path.join(dir, relPath)).catch(() => null);
    if (stat && stat.size <= MAX_AUTOSAVE_FILE_BYTES) files.push({ relPath, stat });
  }
  const statKey = files.map(({ relPath, stat }) => `${relPath}\0${stat.size}\0${stat.mtimeMs}`).join('\n');
  if (lastSeen.get(projectId) === statKey) return null;

  const hash = crypto.createHash('sha256');
  const contents = [];
  for (const { relPath } of files) {
    const content = await fs.readFile(path.join(dir, relPath)).catch(() => null);
    if (!content) continue;
    contents.push({ relPath, content });
    hash.update(relPath).update('\0').update(content).update('\0');
  }
  const digest = hash.digest('hex');
  const index = await readIndex(ownerId, projectId);
  const previous = index.filter((v) => v.trigger === 'autosave').at(-1);
  lastSeen.set(projectId, statKey);
  // Times can change with no change in content (a save of the same text, a
  // git checkout), and a restart forgets lastSeen; the content decides.
  if (previous?.hash === digest || contents.length === 0) return null;

  const id = nanoid(10);
  const target = path.join(versionsDir(ownerId, projectId), id);
  for (const { relPath, content } of contents) {
    await fs.mkdir(path.dirname(path.join(target, relPath)), { recursive: true });
    await fs.writeFile(path.join(target, relPath), content);
  }
  await updateJson(indexPath(ownerId, projectId), [], async (current) => {
    const next = [...current, { id, label: null, trigger: 'autosave', textOnly: true, hash: digest, createdAt: new Date().toISOString() }];
    const autos = next.filter((v) => v.trigger === 'autosave');
    if (autos.length <= MAX_AUTOSAVES) return next;
    const toRemove = autos.slice(0, autos.length - MAX_AUTOSAVES);
    for (const v of toRemove) {
      await fs.rm(path.join(versionsDir(ownerId, projectId), v.id), { recursive: true, force: true });
    }
    const removeIds = new Set(toRemove.map((v) => v.id));
    return next.filter((v) => !removeIds.has(v.id));
  });
  return { id, trigger: 'autosave' };
}

let autosaveTimer = null;
let autosaving = false;

async function autosaveAll(log) {
  if (autosaving) return;
  autosaving = true;
  try {
    const owners = await readJson(PROJECTS_INDEX_FILE, {});
    for (const [projectId, ownerId] of Object.entries(owners)) {
      try {
        await autosaveIfChanged(ownerId, projectId);
      } catch (err) {
        // A project deleted or unreadable mid-scan; the others still get saved.
        if (err.code !== 'ENOENT') log.warn({ err, projectId }, 'autosave failed');
      }
    }
  } finally {
    autosaving = false;
  }
}

export function startAutosave(log) {
  autosaveTimer = setInterval(() => autosaveAll(log), AUTOSAVE_INTERVAL_MS);
  autosaveTimer.unref();
}

export function stopAutosave() {
  clearInterval(autosaveTimer);
  autosaveTimer = null;
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

  if (target.textOnly) {
    // An autosave holds only the writing: those files go back as they were,
    // and figures, data and files added since are left as they are.
    for (const relPath of await walkWriting(src)) {
      const to = path.join(dir, relPath);
      await assertInsideRoot(dir, to);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(path.join(src, relPath), to);
    }
  } else {
    const currentEntries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of currentEntries) {
      if (SKIP_ENTRIES.has(entry.name)) continue;
      await fs.rm(path.join(dir, entry.name), { recursive: true, force: true });
    }
    await copyProjectContents(src, dir);
  }

  // Bump updatedAt (dashboard) and collabGeneration — the latter changes the
  // room identity every live editor uses, so a restore can't be silently
  // undone by an in-flight collaborative session resurrecting pre-restore
  // content (see collab.invalidateProject, called by the route after this).
  await updateManifest(ownerId, projectId, (manifest) => ({
    ...manifest,
    collabGeneration: (manifest.collabGeneration ?? 0) + 1,
  }));
  return { ok: true };
}
