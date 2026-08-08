import { SHARED_INDEX_FILE } from '../config.js';
import { readJson, updateJson } from './jsonStore.js';

// Reverse index of "what's been shared with me" — { [userId]: [{projectId, ownerId}] } —
// kept as a flat JSON file for the same reason as projectIndex.js (small-scale
// deployment, no database). Without this, answering "what's shared with user X"
// would mean scanning every other user's project directory tree.
//
// Sharing one project with several people at once is the normal way this gets
// used, and every one of those writes touches this same file — so the mutations
// below go through updateJson to serialize them.

export async function listForUser(userId) {
  const index = await readJson(SHARED_INDEX_FILE, {});
  return index[userId] ?? [];
}

export async function addShare(userId, projectId, ownerId) {
  await updateJson(SHARED_INDEX_FILE, {}, (index) => {
    const entries = index[userId] ?? [];
    if (entries.some((e) => e.projectId === projectId)) return index;
    return { ...index, [userId]: [...entries, { projectId, ownerId }] };
  });
}

export async function removeShare(userId, projectId) {
  await updateJson(SHARED_INDEX_FILE, {}, (index) => ({
    ...index,
    [userId]: (index[userId] ?? []).filter((e) => e.projectId !== projectId),
  }));
}
