import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { PROJECTS_DIR } from '../config.js';
import { projectDir } from './storage.js';
import { templateContent } from './templates.js';
import { ensureGitRepo } from './projectGit.js';

async function manifestPath(projectId) {
  return path.join(projectDir(projectId), 'manifest.json');
}

export async function readManifest(projectId) {
  const content = await fs.readFile(await manifestPath(projectId), 'utf8');
  return JSON.parse(content);
}

export async function writeManifest(projectId, manifest) {
  manifest.updatedAt = new Date().toISOString();
  await fs.writeFile(await manifestPath(projectId), JSON.stringify(manifest, null, 2));
  return manifest;
}

export async function listProjects() {
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
  const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      projects.push(await readManifest(entry.name));
    } catch {
      // skip folders without a valid manifest
    }
  }
  projects.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return projects;
}

export async function createProject(name, templateId = 'blank') {
  const id = nanoid(10);
  const dir = projectDir(id);
  await fs.mkdir(path.join(dir, 'figures'), { recursive: true });

  const now = new Date().toISOString();
  const manifest = {
    id,
    name,
    mainFile: 'main.tex',
    compiler: 'pdflatex',
    createdAt: now,
    updatedAt: now,
    files: [{ path: 'main.tex', type: 'tex' }],
  };

  await fs.writeFile(path.join(dir, 'main.tex'), templateContent(templateId, name));
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await ensureGitRepo(id);

  return manifest;
}

export async function deleteProject(projectId) {
  await fs.rm(projectDir(projectId), { recursive: true, force: true });
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
export async function buildManifestFromDirectory(id, name, dir, fallbackName) {
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
    name: name?.trim() || fallbackName,
    mainFile,
    compiler: 'pdflatex',
    createdAt: now,
    files,
  };
  const written = await writeManifest(id, manifest);
  await ensureGitRepo(id);
  return written;
}

// Rebuilds the manifest's file list from what's actually on disk, keeping
// everything else (id, name, mainFile, compiler) as-is. Needed after a git
// pull, which can add/remove/rename files without going through the normal
// upsert/remove/rename-file-entry calls.
export async function syncFilesFromDisk(projectId) {
  const manifest = await readManifest(projectId);
  const dir = projectDir(projectId);
  const relPaths = await walkFiles(dir);
  manifest.files = relPaths.map((p) => ({ path: p, type: fileTypeFor(p) }));
  if (!manifest.files.some((f) => f.path === manifest.mainFile)) {
    manifest.mainFile = manifest.files.find((f) => f.type === 'tex')?.path ?? manifest.mainFile;
  }
  return writeManifest(projectId, manifest);
}

// Adds or updates a file entry in the manifest (idempotent on `path`).
export async function upsertFileEntry(projectId, relPath, extra = {}) {
  const manifest = await readManifest(projectId);
  const entry = { path: relPath, type: fileTypeFor(relPath), ...extra };
  const idx = manifest.files.findIndex((f) => f.path === relPath);
  if (idx === -1) manifest.files.push(entry);
  else manifest.files[idx] = { ...manifest.files[idx], ...entry };
  return writeManifest(projectId, manifest);
}

export async function removeFileEntry(projectId, relPath) {
  const manifest = await readManifest(projectId);
  manifest.files = manifest.files.filter((f) => f.path !== relPath);
  return writeManifest(projectId, manifest);
}

export async function renameFileEntry(projectId, oldPath, newPath) {
  const manifest = await readManifest(projectId);
  const entry = manifest.files.find((f) => f.path === oldPath);
  if (entry) {
    entry.path = newPath;
    entry.type = fileTypeFor(newPath);
  }
  return writeManifest(projectId, manifest);
}
