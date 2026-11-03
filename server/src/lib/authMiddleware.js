import * as projectIndex from './projectIndex.js';
import { readManifest } from './manifest.js';
import { findUserById } from './auth.js';
import { findDeviceByToken } from './devices.js';

const RENEW_AFTER_SECONDS = 60 * 60;

// A laptop's token works only on routes that opt in with `config: { allowDevice:
// true }`, so one left on a stolen laptop can sync papers but can't reach account
// settings, sharing or the admin panel.
async function authenticateDevice(req, reply, token) {
  const device = await findDeviceByToken(token);
  const user = device && (await findUserById(device.userId));
  if (!user || user.disabled) {
    return reply.code(401).send({ error: 'this computer is no longer connected' });
  }
  req.userId = user.id;
  req.deviceId = device.id;
}

export async function requireAuth(req, reply) {
  if (req.routeOptions.config?.allowDevice) {
    const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
    if (bearer) return authenticateDevice(req, reply, bearer[1]);
  }
  const userId = req.session.get('userId');
  if (!userId) {
    return reply.code(401).send({ error: 'not authenticated' });
  }
  // A disabled account's existing session cookie must stop working
  // immediately, not just its future logins.
  const user = await findUserById(userId);
  if (!user || user.disabled) {
    req.session.delete();
    return reply.code(401).send({ error: 'not authenticated' });
  }
  req.userId = userId;
  renewSession(req);
}

// The session's clock starts at sign-in and doesn't move by itself, so a person
// who uses Quireloop every day would still be signed out when it ran out.
function renewSession(req) {
  const now = Math.round(Date.now() / 1000);
  if (now - req.session.get('__ts') > RENEW_AFTER_SECONDS) req.session.set('__ts', now);
}

export async function requireAdmin(req, reply) {
  await requireAuth(req, reply);
  if (reply.sent) return;
  const user = await findUserById(req.userId);
  if (user.role !== 'admin') {
    return reply.code(403).send({ error: 'admin access required' });
  }
}

// A collaborator entry with no `role` predates Stage B — treat it as an
// editor (the only level that existed before roles). Normalized here on
// read rather than via a startup migration.
export function normalizeCollabRole(collaborator) {
  return collaborator.role === 'viewer' ? 'viewer' : 'editor';
}

// 'owner' | 'editor' | 'viewer' | null (no access at all).
export function resolveRole(manifest, userId) {
  // A copy of a paper this person may only read on the server stays read-only.
  if (manifest.ownerId === userId) return manifest.sync?.role === 'viewer' ? 'viewer' : 'owner';
  const collaborator = (manifest.collaborators ?? []).find((c) => c.userId === userId);
  if (!collaborator) return null;
  return normalizeCollabRole(collaborator);
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

  const role = resolveRole(manifest, req.userId);
  if (!role) {
    return reply.code(403).send({ error: 'forbidden' });
  }

  req.ownerId = ownerId;
  req.manifest = manifest;
  req.projectRole = role;
}

export async function requireProjectOwner(req, reply) {
  await requireProjectAccess(req, reply);
  if (reply.sent) return;

  if (req.projectRole !== 'owner') {
    return reply.code(403).send({ error: 'forbidden' });
  }
}

// Viewers get every read (including compile/SyncTeX, which they need for
// the PDF) but no write — anything that changes files, the git working
// tree, or version history requires this instead of requireProjectAccess.
export async function requireProjectWrite(req, reply) {
  await requireProjectAccess(req, reply);
  if (reply.sent) return;

  if (req.projectRole === 'viewer') {
    return reply.code(403).send({ error: 'read-only access' });
  }
}
