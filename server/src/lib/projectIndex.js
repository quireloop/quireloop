import { PROJECTS_INDEX_FILE } from '../config.js';
import { readJson, updateJson } from './jsonStore.js';

// A project's URL (/api/projects/:id) doesn't carry its owner, so anything
// that only has a projectId — auth middleware first among them — needs a
// fast way to find out whose directory it lives under. This is that map,
// { [projectId]: ownerId }, kept as a flat JSON file since this is a
// small-scale deployment (tens of users/projects), not a case that needs
// a real database.
//
// Writes go through updateJson so two projects created at the same moment
// can't clobber each other's index entry — losing one here makes that
// project permanently unreachable, since nothing else maps id -> owner.

export async function getOwner(projectId) {
  const index = await readJson(PROJECTS_INDEX_FILE, {});
  return index[projectId] ?? null;
}

export async function setOwner(projectId, ownerId) {
  await updateJson(PROJECTS_INDEX_FILE, {}, (index) => ({ ...index, [projectId]: ownerId }));
}

export async function removeOwner(projectId) {
  await updateJson(PROJECTS_INDEX_FILE, {}, (index) => {
    const next = { ...index };
    delete next[projectId];
    return next;
  });
}
