import { nanoid } from 'nanoid';
import { SHARE_LINKS_FILE } from '../config.js';
import { readJson, updateJson, updateJsonWithResult } from './jsonStore.js';

// Tokenized, revocable invite links with a role attached — join a project
// without the owner needing to know your email up front. Stored the same
// way as invites.js: a flat JSON array, small-scale by design, with every
// mutation serialized through the shared JSON store.
const MODE = { mode: 0o600 };

export async function createShareLink(projectId, ownerId, role) {
  const link = {
    token: nanoid(16),
    projectId,
    ownerId,
    role: role === 'viewer' ? 'viewer' : 'editor',
    createdAt: new Date().toISOString(),
    revoked: false,
  };
  await updateJson(SHARE_LINKS_FILE, [], (links) => [...links, link], MODE);
  return link;
}

export async function listShareLinks(projectId) {
  const links = await readJson(SHARE_LINKS_FILE, []);
  return links.filter((l) => l.projectId === projectId && !l.revoked);
}

// Revocation must not be lost to a concurrent write — a link that silently
// stays live is a standing grant of access to the project.
export async function revokeShareLink(projectId, token) {
  return updateJsonWithResult(
    SHARE_LINKS_FILE,
    [],
    (links) => {
      const link = links.find((l) => l.projectId === projectId && l.token === token);
      if (!link || link.revoked) return { value: undefined, result: false };
      return {
        value: links.map((l) => (l === link ? { ...l, revoked: true } : l)),
        result: true,
      };
    },
    MODE
  );
}

export async function findShareLink(token) {
  const links = await readJson(SHARE_LINKS_FILE, []);
  const link = links.find((l) => l.token === token);
  if (!link || link.revoked) return null;
  return link;
}
