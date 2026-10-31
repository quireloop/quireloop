import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { userDir, projectDir } from './storage.js';
import { templateContent } from './templates.js';
import { ensureGitRepo, hasGitRepo } from './projectGit.js';
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
    // A linked project (see linkProject) is a symlink to a folder elsewhere on
    // the host, and readdir reports it as a link, not a directory — checking
    // only isDirectory() would hide every linked project from the dashboard.
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
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

// True when this project is a link to a folder the user already had on the
// host, rather than a directory Quireloop created and owns.
export async function isLinkedProject(ownerId, projectId) {
  try {
    return (await fs.lstat(projectDir(ownerId, projectId))).isSymbolicLink();
  } catch {
    return false;
  }
}

// Opens a folder that already exists on the host as a project, in place — no
// copy. The project slot under data/projects/ is a symlink to it, which means
// every other part of the app (compile, git, collab, versions, search) keeps
// working through projectDir() with no idea anything is different.
//
// Quireloop's bookkeeping (manifest.json, build/, versions/) is written into
// that folder, deliberately: the project stays self-describing and portable,
// and the compiled PDF lands next to the sources where the user expects it.
export async function linkProject(ownerId, sourcePath, name, { initGit = false } = {}) {
  const existing = await listProjects(ownerId);
  const already = existing.find((p) => p.linkedPath === sourcePath);
  if (already) {
    throw new Error(`that folder is already open as "${already.name}"`);
  }

  const id = nanoid(10);
  const slot = projectDir(ownerId, id);
  await fs.mkdir(userDir(ownerId), { recursive: true });
  await fs.symlink(sourcePath, slot, 'dir');

  try {
    // A folder opened before, then removed from the dashboard, still has its
    // manifest.json — reuse the name/main file/compiler chosen last time
    // rather than re-deriving them and losing the user's settings.
    const previous = await readManifest(ownerId, id).catch(() => null);
    return await buildManifestFromDirectory(ownerId, id, name || previous?.name, slot, path.basename(sourcePath), {
      initGit,
      extra: {
        linkedPath: sourcePath,
        ...(previous?.mainFile ? { mainFile: previous.mainFile } : {}),
        ...(previous?.compiler ? { compiler: previous.compiler } : {}),
      },
    });
  } catch (err) {
    // Never leave a dangling slot pointing at the user's folder if the
    // manifest couldn't be built (e.g. the folder turned out to be empty).
    await fs.rm(slot, { force: true }).catch(() => {});
    throw err;
  }
}

export async function deleteProject(ownerId, projectId) {
  const dir = projectDir(ownerId, projectId);
  // fs.rm unlinks a symlink rather than descending into its target, so a
  // linked project's real folder is never touched — but this is the one call
  // in the app that would destroy a user's own files if that ever changed, so
  // the two cases are spelled out separately instead of relying on it.
  if (await isLinkedProject(ownerId, projectId)) {
    await fs.unlink(dir);
  } else {
    await fs.rm(dir, { recursive: true, force: true });
  }
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
// `initGit` is off for linked projects: running `git init` inside a folder the
// user already had is a visible, unasked-for change to their own directory.
// An already-initialised repo there still gets the full Source Control panel,
// since ensureGitRepo is a no-op on a folder that has a .git.
export async function buildManifestFromDirectory(
  ownerId,
  id,
  name,
  dir,
  fallbackName,
  { initGit = true, extra = {} } = {}
) {
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
    ...extra,
  };
  // `extra` may carry a mainFile remembered from a previous session; drop it
  // if that file isn't on disk any more, or compile would fail on a name the
  // user can't see in the file tree.
  if (!files.some((f) => f.path === manifest.mainFile)) manifest.mainFile = mainFile;
  const written = await writeManifest(ownerId, id, manifest);
  await projectIndex.setOwner(id, ownerId);
  if (initGit) await ensureGitRepo(ownerId, id);
  // A folder whose repository isn't accepted still opens, just without git.
  else if (await hasGitRepo(dir)) await ensureGitRepo(ownerId, id).catch(() => {});
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
