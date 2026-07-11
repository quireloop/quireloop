import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { nanoid } from 'nanoid';
import { projectDir } from './storage.js';
import { buildManifestFromDirectory } from './manifest.js';

const UNZIP_TIMEOUT_MS = 60_000;

// Many zip exports (including the hosted editor's "Download .zip") wrap every file
// inside one top-level folder. If that's all we find at the root, treat
// that folder's contents as the project root instead of nesting the whole
// project one level deeper than expected.
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
    await execa('unzip', ['-q', '-o', tmpZip, '-d', dir], { timeout: UNZIP_TIMEOUT_MS });
  } catch {
    await fs.rm(dir, { recursive: true, force: true });
    throw new Error("couldn't extract that file — is it a valid .zip?");
  } finally {
    await fs.rm(tmpZip, { force: true });
  }

  await fs.rm(path.join(dir, '__MACOSX'), { recursive: true, force: true });
  await flattenSingleWrapperFolder(dir);

  try {
    return await buildManifestFromDirectory(ownerId, id, name, dir, 'Uploaded project');
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true });
    throw new Error(err.message === 'no files found' ? 'that zip has no files in it' : err.message);
  }
}
