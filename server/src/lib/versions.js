import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { projectDir } from './storage.js';
import { readManifest, writeManifest } from './manifest.js';

const MAX_AUTO_SNAPSHOTS = 20;
const SKIP_ENTRIES = new Set(['build', 'versions']);

function versionsDir(projectId) {
  return path.join(projectDir(projectId), 'versions');
}

function indexPath(projectId) {
  return path.join(versionsDir(projectId), 'index.json');
}

async function readIndex(projectId) {
  try {
    return JSON.parse(await fs.readFile(indexPath(projectId), 'utf8'));
  } catch {
    return [];
  }
}

async function writeIndex(projectId, index) {
  await fs.mkdir(versionsDir(projectId), { recursive: true });
  await fs.writeFile(indexPath(projectId), JSON.stringify(index, null, 2));
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
export async function createSnapshot(projectId, { label, trigger }) {
  const id = nanoid(10);
  await copyProjectContents(projectDir(projectId), path.join(versionsDir(projectId), id));

  const index = await readIndex(projectId);
  index.push({ id, label: label || null, trigger, createdAt: new Date().toISOString() });

  if (trigger === 'compile') {
    const autos = index.filter((v) => v.trigger === 'compile');
    if (autos.length > MAX_AUTO_SNAPSHOTS) {
      const toRemove = autos.slice(0, autos.length - MAX_AUTO_SNAPSHOTS);
      for (const v of toRemove) {
        await fs.rm(path.join(versionsDir(projectId), v.id), { recursive: true, force: true });
      }
      const removeIds = new Set(toRemove.map((v) => v.id));
      await writeIndex(projectId, index.filter((v) => !removeIds.has(v.id)));
      return { id, label, trigger };
    }
  }

  await writeIndex(projectId, index);
  return { id, label, trigger };
}

export async function listVersions(projectId) {
  const index = await readIndex(projectId);
  return index.slice().reverse();
}

export async function restoreVersion(projectId, versionId) {
  const index = await readIndex(projectId);
  const target = index.find((v) => v.id === versionId);
  if (!target) throw new Error('version not found');

  // Safety net: the current (about-to-be-overwritten) state is itself
  // snapshotted first, so a restore is always reversible.
  await createSnapshot(projectId, { label: 'Before restore', trigger: 'restore' });

  const dir = projectDir(projectId);
  const src = path.join(versionsDir(projectId), versionId);

  const currentEntries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of currentEntries) {
    if (SKIP_ENTRIES.has(entry.name)) continue;
    await fs.rm(path.join(dir, entry.name), { recursive: true, force: true });
  }
  await copyProjectContents(src, dir);

  // Bump updatedAt so the dashboard reflects the restore.
  const manifest = await readManifest(projectId);
  await writeManifest(projectId, manifest);
  return { ok: true };
}
