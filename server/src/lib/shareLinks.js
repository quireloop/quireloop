import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { SHARE_LINKS_FILE } from '../config.js';

// Tokenized, revocable invite links with a role attached — join a project
// without the owner needing to know your email up front. Stored the same
// way as invites.js: a flat JSON array, small-scale by design.
async function readLinks() {
  try {
    return JSON.parse(await fs.readFile(SHARE_LINKS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function writeLinks(links) {
  await fs.mkdir(path.dirname(SHARE_LINKS_FILE), { recursive: true });
  await fs.writeFile(SHARE_LINKS_FILE, JSON.stringify(links, null, 2));
}

export async function createShareLink(projectId, ownerId, role) {
  const links = await readLinks();
  const link = {
    token: nanoid(16),
    projectId,
    ownerId,
    role: role === 'viewer' ? 'viewer' : 'editor',
    createdAt: new Date().toISOString(),
    revoked: false,
  };
  links.push(link);
  await writeLinks(links);
  return link;
}

export async function listShareLinks(projectId) {
  const links = await readLinks();
  return links.filter((l) => l.projectId === projectId && !l.revoked);
}

export async function revokeShareLink(projectId, token) {
  const links = await readLinks();
  const link = links.find((l) => l.projectId === projectId && l.token === token);
  if (!link || link.revoked) return false;
  link.revoked = true;
  await writeLinks(links);
  return true;
}

export async function findShareLink(token) {
  const links = await readLinks();
  const link = links.find((l) => l.token === token);
  if (!link || link.revoked) return null;
  return link;
}
