import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { getSettings, updateSettings } from './settings.js';
import { listUsers } from './auth.js';
import { listProjectsForUser } from './manifest.js';
import { projectDir } from './storage.js';
import { listSyncFiles } from './syncFiles.js';

// Keeps ordinary, readable copies of every paper on this computer in a folder
// the person chose. That folder can sit inside OneDrive or Dropbox, whose own
// apps then carry it off the machine, so Quireloop never holds a cloud password.
//
// A backup has to survive the original going bad, so nothing here is deleted:
// a file removed from a paper stays in the copy, and the version a change would
// replace moves to OLDER_DIR/<date>/ first, for KEEP_OLDER_DAYS days.

const COPY_INTERVAL_MS = 5 * 60 * 1000;
export const OLDER_DIR = '_older-versions';
const KEEP_OLDER_DAYS = 30;

let timer = null;
let log = console;
let running = null;
const state = { lastError: null };

export function uniqueFolderName(manifest, used) {
  const base = String(manifest.name || manifest.id).replace(/[^\w .-]/g, '_').replace(/^\.+/, '').trim() || manifest.id;
  let name = base;
  for (let n = 2; used.has(name); n += 1) name = `${base} (${n})`;
  used.add(name);
  return name;
}

async function sameContent(a, b) {
  const [statA, statB] = await Promise.all([fs.stat(a), fs.stat(b).catch(() => null)]);
  if (!statB) return null;
  if (statA.size !== statB.size) return false;
  return (await fs.readFile(a)).equals(await fs.readFile(b));
}

async function copyProject(manifest, target, olderRoot) {
  const source = projectDir(manifest.ownerId, manifest.id);
  const { files } = await listSyncFiles(manifest.ownerId, manifest.id);
  for (const { path: relPath } of files) {
    const from = path.join(source, relPath);
    const to = path.join(target, relPath);
    const same = await sameContent(from, to);
    if (same === true) continue;
    await fs.mkdir(path.dirname(to), { recursive: true });
    if (same === false) {
      const older = path.join(olderRoot, path.basename(target), relPath);
      await fs.mkdir(path.dirname(older), { recursive: true });
      await fs.copyFile(to, older);
    }
    const partial = `${to}.partial`;
    await fs.copyFile(from, partial);
    await fs.rename(partial, to);
  }
}

async function pruneOlder(folder) {
  const root = path.join(folder, OLDER_DIR);
  const cutoff = Date.now() - KEEP_OLDER_DAYS * 24 * 60 * 60 * 1000;
  const days = await fs.readdir(root).catch(() => []);
  for (const day of days) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(day).getTime() < cutoff) {
      await fs.rm(path.join(root, day), { recursive: true, force: true });
    }
  }
}

async function copyEverything(folder) {
  const today = new Date().toISOString().slice(0, 10);
  const olderRoot = path.join(folder, OLDER_DIR, today);
  const seen = new Set();
  const used = new Set([OLDER_DIR]);
  for (const user of await listUsers()) {
    for (const manifest of await listProjectsForUser(user.id)) {
      if (seen.has(manifest.id)) continue;
      seen.add(manifest.id);
      await copyProject(manifest, path.join(folder, uniqueFolderName(manifest, used)), olderRoot);
    }
  }
  await pruneOlder(folder);
}

export async function copyOnce() {
  if (running) return running;
  running = (async () => {
    const { backupFolder } = await getSettings();
    if (!backupFolder) return;
    try {
      await fs.mkdir(backupFolder, { recursive: true });
      await copyEverything(backupFolder);
      state.lastError = null;
      await updateSettings({ backupFolderCopiedAt: new Date().toISOString() });
    } catch (err) {
      state.lastError = `Couldn't copy to the backup folder: ${err.message}`;
      log.warn({ err }, 'backup folder copy failed');
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

export async function getStatus() {
  const { backupFolder, backupFolderCopiedAt } = await getSettings();
  return { path: backupFolder || '', lastCopyAt: backupFolderCopiedAt || null, lastError: state.lastError };
}

export async function setFolder(folder) {
  if (typeof folder !== 'string') throw new Error('choose a folder');
  if (folder && !path.isAbsolute(folder)) throw new Error('enter the full path of the folder');
  const resolved = folder && path.resolve(folder);
  if (resolved && (resolved === DATA_DIR || resolved.startsWith(`${DATA_DIR}${path.sep}`))) {
    throw new Error("that folder is inside Quireloop's own data");
  }
  await updateSettings({ backupFolder: resolved });
  if (resolved) await copyOnce();
  return getStatus();
}

export async function startFolderCopy(logger) {
  log = logger;
  timer = setInterval(() => copyOnce(), COPY_INTERVAL_MS);
  timer.unref();
  await copyOnce();
}

export function stopFolderCopy() {
  clearInterval(timer);
}
