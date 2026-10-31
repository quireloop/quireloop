import fs from 'node:fs/promises';
import { execa } from 'execa';
import { nanoid } from 'nanoid';
import { projectDir } from './storage.js';
import { buildManifestFromDirectory } from './manifest.js';
import { withToken } from './gitAuth.js';
import { GIT_SAFETY, setRemote } from './projectGit.js';

const CLONE_TIMEOUT_MS = 60_000;

export async function importFromGit(ownerId, name, gitUrl, token) {
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
  const dir = projectDir(ownerId, id);
  const authedUrl = withToken(gitUrl, token);

  try {
    await execa('git', [...GIT_SAFETY, 'clone', '--depth', '1', authedUrl, dir], { timeout: CLONE_TIMEOUT_MS });
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

  let manifest;
  try {
    // Deliberately keeps the cloned .git history/remote intact (unlike a
    // detached one-time import) — buildManifestFromDirectory's ensureGitRepo
    // call layers our own ignore rules on top without disturbing it, so the
    // project stays connected to the hosted editor and can be pushed straight back.
    manifest = await buildManifestFromDirectory(ownerId, id, name, dir, 'Imported from the hosted editor');
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true });
    throw new Error(err.message === 'no files found' ? 'the cloned project has no files' : err.message);
  }

  await setRemote(ownerId, id, gitUrl, token);
  return manifest;
}
