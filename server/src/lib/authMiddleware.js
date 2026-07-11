import * as projectIndex from './projectIndex.js';
import { readManifest } from './manifest.js';

export async function requireAuth(req, reply) {
  const userId = req.session.get('userId');
  if (!userId) {
    return reply.code(401).send({ error: 'not authenticated' });
  }
  req.userId = userId;
}

function hasProjectAccess(manifest, userId) {
  if (manifest.ownerId === userId) return true;
  return (manifest.collaborators ?? []).some((c) => c.userId === userId);
}

// Resolves :id -> its owner via the project index (the URL only ever
// carries a projectId, never who owns it), loads the manifest once, and
// decorates the request so route handlers don't each re-derive this.
export async function requireProjectAccess(req, reply) {
  await requireAuth(req, reply);
  if (reply.sent) return;

  const projectId = req.params.id;
  const ownerId = await projectIndex.getOwner(projectId);
  if (!ownerId) {
    return reply.code(404).send({ error: 'project not found' });
  }

  let manifest;
  try {
    manifest = await readManifest(ownerId, projectId);
  } catch {
    return reply.code(404).send({ error: 'project not found' });
  }

  if (!hasProjectAccess(manifest, req.userId)) {
    return reply.code(403).send({ error: 'forbidden' });
  }

  req.ownerId = ownerId;
  req.manifest = manifest;
}

export async function requireProjectOwner(req, reply) {
  await requireProjectAccess(req, reply);
  if (reply.sent) return;

  if (req.manifest.ownerId !== req.userId) {
    return reply.code(403).send({ error: 'forbidden' });
  }
}
