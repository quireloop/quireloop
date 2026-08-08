import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { userDir, projectDir } from './storage.js';
import { templateContent } from './templates.js';
import { ensureGitRepo } from './projectGit.js';
import * as projectIndex from './projectIndex.js';
import * as sharedIndex from './sharedIndex.js';
import { withLock, writeJsonAtomic } from './jsonStore.js';

function manifestPath(ownerId, projectId) {
  return path.join(projectDir(ownerId, projectId), 'manifest.json');
}

export async function readManifest(ownerId, projectId) {
  const content = await fs.readFile(manifestPath(ownerId, projectId), 'utf8');
  return JSON.parse(content);
}

export async function writeManifest(ownerId, projectId, manifest) {
  const next = { ...manifest, updatedAt: new Date().toISOString() };
  await writeJsonAtomic(manifestPath(ownerId, projectId), next);
  return next;
}

// Every mutation below is a read-modify-write of one project's manifest, and
// collaborators editing the same project hit it concurrently — saving files,
// uploading figures, renaming. Unserialized, the later write overwrote the
// earlier one's file list: measured at 15 concurrent saves producing 14 files
// on disk but only 9 manifest entries, so five files vanished from the UI and
// from the compile. `mutate` receives the manifest and returns the new one.
export async function updateManifest(ownerId, projectId, mutate) {
  const file = manifestPath(ownerId, projectId);
  return withLock(file, async () => {
    const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
    const next = { ...(await mutate(manifest)), updatedAt: new Date().toISOString() };
    await writeJsonAtomic(file, next);
    return next;
  });
}

// Projects this user owns — not the ones shared with them (see
// listProjectsForUser in sharedIndex.js, added in Stage 2).
export async function listProjects(ownerId) {
  const dir = userDir(ownerId);
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      projects.push(await readManifest(ownerId, entry.name));
    } catch {
      // skip folders without a valid manifest
    }
  }
  projects.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return projects;
}

// Own projects + projects shared with this user (via sharedIndex), for the
// dashboard's project list.
export async function listProjectsForUser(userId) {
  const owned = await listProjects(userId);
  const shared = await sharedIndex.listForUser(userId);
  const sharedProjects = [];
  for (const { projectId, ownerId } of shared) {
    try {
      sharedProjects.push(await readManifest(ownerId, projectId));
    } catch {
      // project or manifest gone — skip stale shared-index entry
    }
  }
  const all = [...owned, ...sharedProjects];
  all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return all;
}

export async function createProject(ownerId, name, templateId = 'blank') {
  const id = nanoid(10);
  const dir = projectDir(ownerId, id);
  await fs.mkdir(path.join(dir, 'figures'), { recursive: true });

  const now = new Date().toISOString();
  const manifest = {
    id,
    ownerId,
    collaborators: [],
    collabGeneration: 0,
    name,
    mainFile: 'main.tex',
    compiler: 'pdflatex',
    createdAt: now,
    updatedAt: now,
    files: [{ path: 'main.tex', type: 'tex' }],
  };

  await fs.writeFile(path.join(dir, 'main.tex'), templateContent(templateId, name));
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await projectIndex.setOwner(id, ownerId);
  await ensureGitRepo(ownerId, id);

  return manifest;
}

export async function deleteProject(ownerId, projectId) {
  await fs.rm(projectDir(ownerId, projectId), { recursive: true, force: true });
  await projectIndex.removeOwner(projectId);
}

const EXT_TYPES = {
  '.tex': 'tex',
  '.bib': 'bib',
  '.cls': 'cls',
  '.sty': 'sty',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.pdf': 'image',
};

export function fileTypeFor(relPath) {
  return EXT_TYPES[path.extname(relPath).toLowerCase()] ?? 'other';
}

// Quireloop's own bookkeeping, sitting at the project root alongside the
// real content — never something to list as one of the project's files.
const BOOKKEEPING_ENTRIES = new Set(['manifest.json', 'build', 'versions']);

async function walkFiles(root, base = '') {
  const entries = await fs.readdir(path.join(root, base), { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue;
    if (!base && BOOKKEEPING_ENTRIES.has(entry.name)) continue;
    const relPath = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files = files.concat(await walkFiles(root, relPath));
    } else {
      files.push(relPath);
    }
  }
  return files;
}

// Builds and writes a manifest for a project whose files already exist on
// disk at `dir` (used by git-import and zip-upload, which both drop a whole
// tree in place first and need a manifest built from what's actually there).
export async function buildManifestFromDirectory(ownerId, id, name, dir, fallbackName) {
  const relPaths = await walkFiles(dir);
  if (relPaths.length === 0) {
    throw new Error('no files found');
  }
  const files = relPaths.map((p) => ({ path: p, type: fileTypeFor(p) }));
  const mainFile =
    files.find((f) => f.path === 'main.tex')?.path ??
    files.find((f) => f.type === 'tex')?.path ??
    files[0].path;

  const now = new Date().toISOString();
  const manifest = {
    id,
    ownerId,
    collaborators: [],
    collabGeneration: 0,
    name: name?.trim() || fallbackName,
    mainFile,
    compiler: 'pdflatex',
    createdAt: now,
    files,
  };
  const written = await writeManifest(ownerId, id, manifest);
  await projectIndex.setOwner(id, ownerId);
  await ensureGitRepo(ownerId, id);
  return written;
}

// Rebuilds the manifest's file list from what's actually on disk, keeping
// everything else (id, name, mainFile, compiler) as-is. Needed after a git
// pull, which can add/remove/rename files without going through the normal
// upsert/remove/rename-file-entry calls.
export async function syncFilesFromDisk(ownerId, projectId) {
  const dir = projectDir(ownerId, projectId);
  return updateManifest(ownerId, projectId, async (manifest) => {
    const relPaths = await walkFiles(dir);
    const files = relPaths.map((p) => ({ path: p, type: fileTypeFor(p) }));
    const mainFile = files.some((f) => f.path === manifest.mainFile)
      ? manifest.mainFile
      : (files.find((f) => f.type === 'tex')?.path ?? manifest.mainFile);
    return { ...manifest, files, mainFile };
  });
}

// Adds or updates a file entry in the manifest (idempotent on `path`).
export async function upsertFileEntry(ownerId, projectId, relPath, extra = {}) {
  return updateManifest(ownerId, projectId, (manifest) => {
    const entry = { path: relPath, type: fileTypeFor(relPath), ...extra };
    const idx = manifest.files.findIndex((f) => f.path === relPath);
    const files = [...manifest.files];
    if (idx === -1) files.push(entry);
    else files[idx] = { ...files[idx], ...entry };
    return { ...manifest, files };
  });
}

export async function removeFileEntry(ownerId, projectId, relPath) {
  return updateManifest(ownerId, projectId, (manifest) => ({
    ...manifest,
    files: manifest.files.filter((f) => f.path !== relPath),
  }));
}

export async function renameFileEntry(ownerId, projectId, oldPath, newPath) {
  return updateManifest(ownerId, projectId, (manifest) => ({
    ...manifest,
    files: manifest.files.map((f) =>
      f.path === oldPath ? { ...f, path: newPath, type: fileTypeFor(newPath) } : f
    ),
  }));
}
