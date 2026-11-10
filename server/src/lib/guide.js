import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { findUserById, updateUser } from './auth.js';
import { buildManifestFromDirectory } from './manifest.js';
import { projectDir, userDir } from './storage.js';
import { withLock } from './jsonStore.js';

const GUIDE_SOURCE = path.resolve(import.meta.dirname, '../guide');

// The guide covers what this install can do: a personal install links to a
// server and keeps a backup folder, a server has an admin and server accounts.
// Told apart by the address the browser used, as the dashboard does.
export function isPersonalHost(hostname) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
}

// Keeps the lines meant for this kind of install: %%%% PERSONAL ... %%%% END
// or %%%% SERVER ... %%%% END. The markers themselves go too.
export function guideText(source, personal) {
  const keep = personal ? 'PERSONAL' : 'SERVER';
  const out = [];
  let block = null;
  // The opening comment explains these markers to whoever edits the source.
  const lines = source.split('\n');
  while (lines.length && lines[0].startsWith('%')) lines.shift();
  for (const line of lines) {
    const marker = line.match(/^%%%% (PERSONAL|SERVER|END)\s*$/);
    if (marker) {
      block = marker[1] === 'END' ? null : marker[1];
      continue;
    }
    if (block === null || block === keep) out.push(line);
  }
  return out.join('\n');
}

// Gives an account its own copy of the guide, once: the first time it signs in
// after this feature arrived, existing accounts included. Deleting the copy is
// the user's choice and is respected; the flag on the account, not the
// project's existence, decides.
export async function ensureGuide(userId, { personal }) {
  return withLock(`guide:${userId}`, async () => {
    const user = await findUserById(userId);
    if (!user || user.guideCreated) return null;

    const id = nanoid(10);
    const dir = projectDir(userId, id);
    await fs.mkdir(userDir(userId), { recursive: true });
    await fs.cp(path.join(GUIDE_SOURCE, 'figures'), path.join(dir, 'figures'), { recursive: true });
    const source = await fs.readFile(path.join(GUIDE_SOURCE, 'main.tex'), 'utf8');
    await fs.writeFile(path.join(dir, 'main.tex'), guideText(source, personal));
    try {
      const manifest = await buildManifestFromDirectory(
        userId,
        id,
        personal ? 'Quireloop guide' : 'Quireloop guide (server)',
        dir,
        'Quireloop guide'
      );
      await updateUser(userId, { guideCreated: true });
      return manifest;
    } catch (err) {
      await fs.rm(dir, { recursive: true, force: true });
      throw err;
    }
  });
}
