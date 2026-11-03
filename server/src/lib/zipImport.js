import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { nanoid } from 'nanoid';
import { projectDir } from './storage.js';
import { buildManifestFromDirectory } from './manifest.js';

const UNZIP_TIMEOUT_MS = 60_000;

// Many zip exports wrap every file
// inside one top-level folder. If that's all we find at the root, treat
// that folder's contents as the project root instead of nesting the whole
// project one level deeper than expected.
// Belt-and-suspenders on top of the extractor's own zip-slip
// protection: walk the extracted tree and confirm nothing symlinks or
// resolves outside the project directory before we treat it as real content.
async function assertExtractionContained(dir) {
  const base = await fs.realpath(dir);
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const real = await fs.realpath(full).catch(() => full);
      if (real !== base && !real.startsWith(base + path.sep)) {
        throw new Error('zip contains an entry that escapes the project folder');
      }
      if (entry.isDirectory() && !entry.isSymbolicLink()) await walk(full);
    }
  }
  await walk(base);
}

// Windows has no unzip, but 10 and later ship bsdtar, which reads zip files
// and refuses entries naming ".." or an absolute path. Named by full path:
// the tar that comes with Git for Windows comes first on PATH and can't.
function unzipCommand(zip, dir) {
  if (process.platform === 'win32') {
    const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    return [tar, ['-xf', zip, '-C', dir]];
  }
  return ['unzip', ['-q', '-o', zip, '-d', dir]];
}

async function flattenSingleWrapperFolder(dir) {
  const entries = (await fs.readdir(dir, { withFileTypes: true })).filter((e) => !e.name.startsWith('.'));
  if (entries.length !== 1 || !entries[0].isDirectory()) return;
  const wrapper = path.join(dir, entries[0].name);
  for (const name of await fs.readdir(wrapper)) {
    await fs.rename(path.join(wrapper, name), path.join(dir, name));
  }
  await fs.rm(wrapper, { recursive: true, force: true });
}

export async function importFromZip(ownerId, name, buffer) {
  const id = nanoid(10);
  const dir = projectDir(ownerId, id);
  await fs.mkdir(dir, { recursive: true });

  const tmpZip = path.join(os.tmpdir(), `quireloop-upload-${id}.zip`);
  await fs.writeFile(tmpZip, buffer);

  try {
    const [file, args] = unzipCommand(tmpZip, dir);
    await execa(file, args, { timeout: UNZIP_TIMEOUT_MS });
    await assertExtractionContained(dir);
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true });
    throw err.message?.startsWith('zip contains') ? err : new Error("couldn't extract that file — is it a valid .zip?");
  } finally {
    await fs.rm(tmpZip, { force: true });
  }

  await fs.rm(path.join(dir, '__MACOSX'), { recursive: true, force: true });
  await flattenSingleWrapperFolder(dir);
  // git's config can name programs to run, so one from a zip is never trusted.
  await fs.rm(path.join(dir, '.git'), { recursive: true, force: true });

  try {
    return await buildManifestFromDirectory(ownerId, id, name, dir, 'Uploaded project');
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true });
    throw new Error(err.message === 'no files found' ? 'that zip has no files in it' : err.message);
  }
}
