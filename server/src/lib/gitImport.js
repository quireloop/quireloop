import fs from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { nanoid } from 'nanoid';
import { projectDir } from './storage.js';
import { writeManifest, fileTypeFor } from './manifest.js';

const CLONE_TIMEOUT_MS = 60_000;

// the hosted editor's git bridge (git.hosted-editor.com/<project-id>) authenticates over
// HTTPS with the project's git token as the username and an empty password
// — there's no separate "password" concept to ask the user for.
function withToken(gitUrl, token) {
  const url = new URL(gitUrl);
  if (token) {
    url.username = token;
    url.password = '';
  }
  return url.toString();
}

async function walkFiles(root, base = '') {
  const entries = await fs.readdir(path.join(root, base), { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue; // skip .git and dotfiles
    const relPath = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files = files.concat(await walkFiles(root, relPath));
    } else {
      files.push(relPath);
    }
  }
  return files;
}

export async function importFromGit(name, gitUrl, token) {
  let parsed;
  try {
    parsed = new URL(gitUrl);
  } catch {
    throw new Error("that doesn't look like a valid URL");
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('only https:// git URLs are supported');
  }

  const id = nanoid(10);
  const dir = projectDir(id);
  const authedUrl = withToken(gitUrl, token);

  try {
    await execa('git', ['clone', '--depth', '1', authedUrl, dir], { timeout: CLONE_TIMEOUT_MS });
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true });
    const stderr = err.stderr ?? '';
    if (/authentication|403/i.test(stderr)) {
      throw new Error('authentication failed — check the git token and try again');
    }
    if (err.timedOut) {
      throw new Error('the clone timed out — check the URL and your connection');
    }
    throw new Error('git clone failed — check the URL and try again');
  }

  await fs.rm(path.join(dir, '.git'), { recursive: true, force: true });

  const relPaths = await walkFiles(dir);
  if (relPaths.length === 0) {
    await fs.rm(dir, { recursive: true, force: true });
    throw new Error('the cloned project has no files');
  }
  const files = relPaths.map((p) => ({ path: p, type: fileTypeFor(p) }));
  const mainFile =
    files.find((f) => f.path === 'main.tex')?.path ??
    files.find((f) => f.type === 'tex')?.path ??
    files[0].path;

  const now = new Date().toISOString();
  const manifest = {
    id,
    name: name?.trim() || 'Imported from the hosted editor',
    mainFile,
    compiler: 'pdflatex',
    createdAt: now,
    files,
  };
  return writeManifest(id, manifest);
}
