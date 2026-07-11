import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECTS_INDEX_FILE } from '../config.js';

// A project's URL (/api/projects/:id) doesn't carry its owner, so anything
// that only has a projectId — auth middleware first among them — needs a
// fast way to find out whose directory it lives under. This is that map,
// { [projectId]: ownerId }, kept as a flat JSON file since this is a
// small-scale deployment (tens of users/projects), not a case that needs
// a real database.
async function readIndex() {
  try {
    return JSON.parse(await fs.readFile(PROJECTS_INDEX_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function writeIndex(index) {
  await fs.mkdir(path.dirname(PROJECTS_INDEX_FILE), { recursive: true });
  await fs.writeFile(PROJECTS_INDEX_FILE, JSON.stringify(index, null, 2));
}

export async function getOwner(projectId) {
  const index = await readIndex();
  return index[projectId] ?? null;
}

export async function setOwner(projectId, ownerId) {
  const index = await readIndex();
  index[projectId] = ownerId;
  await writeIndex(index);
}

export async function removeOwner(projectId) {
  const index = await readIndex();
  delete index[projectId];
  await writeIndex(index);
}
