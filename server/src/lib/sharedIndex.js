import fs from 'node:fs/promises';
import path from 'node:path';
import { SHARED_INDEX_FILE } from '../config.js';

// Reverse index of "what's been shared with me" — { [userId]: [{projectId, ownerId}] } —
// kept as a flat JSON file for the same reason as projectIndex.js (small-scale
// deployment, no database). Without this, answering "what's shared with user X"
// would mean scanning every other user's project directory tree.
async function readIndex() {
  try {
    return JSON.parse(await fs.readFile(SHARED_INDEX_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function writeIndex(index) {
  await fs.mkdir(path.dirname(SHARED_INDEX_FILE), { recursive: true });
  await fs.writeFile(SHARED_INDEX_FILE, JSON.stringify(index, null, 2));
}

export async function listForUser(userId) {
  const index = await readIndex();
  return index[userId] ?? [];
}

export async function addShare(userId, projectId, ownerId) {
  const index = await readIndex();
  const entries = index[userId] ?? [];
  if (!entries.some((e) => e.projectId === projectId)) {
    entries.push({ projectId, ownerId });
  }
  index[userId] = entries;
  await writeIndex(index);
}

export async function removeShare(userId, projectId) {
  const index = await readIndex();
  const entries = index[userId] ?? [];
  index[userId] = entries.filter((e) => e.projectId !== projectId);
  await writeIndex(index);
}
