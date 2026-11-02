import fs from 'node:fs/promises';
import path from 'node:path';
import * as collab from '../lib/collab.js';
import * as devices from '../lib/devices.js';
import { requireAuth, requireProjectAccess, requireProjectWrite, resolveRole } from '../lib/authMiddleware.js';
import { createProject, listProjectsForUser, removeFileEntry, syncFilesFromDisk, upsertFileEntry, updateManifest } from '../lib/manifest.js';
import { resolveUserPath } from '../lib/storage.js';
import { MAX_SYNC_FILE_BYTES, isSyncablePath, listSyncFiles } from '../lib/syncFiles.js';

// What a linked computer talks to. lib/syncClient.js is the other end.
const device = { config: { allowDevice: true } };
const bodyLimit = MAX_SYNC_FILE_BYTES + 1024 * 1024;

function decode(value) {
  return value ? new Uint8Array(Buffer.from(value, 'base64')) : null;
}

function encode(bytes) {
  return Buffer.from(bytes).toString('base64');
}

async function targetFor(req, relPath) {
  if (!isSyncablePath(relPath)) throw new Error('that path is not synced');
  return resolveUserPath(req.ownerId, req.params.id, relPath);
}

export default async function syncRoutes(app) {
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit }, (_req, body, done) => {
    done(null, body);
  });

  app.post('/api/sync/pair/start', async (req, reply) => {
    try {
      return devices.startPairing(req.body?.deviceName);
    } catch (err) {
      return reply.code(429).send({ error: err.message });
    }
  });

  app.post('/api/sync/pair/poll', async (req, reply) => {
    try {
      return (await devices.collectToken(String(req.body?.deviceCode ?? ''))) ?? { pending: true };
    } catch (err) {
      return reply.code(410).send({ error: err.message });
    }
  });

  app.get('/api/sync/pair/:code', { preHandler: requireAuth }, async (req, reply) => {
    const pairing = devices.describePairing(req.params.code);
    if (!pairing) return reply.code(404).send({ error: 'this code has expired or was already used' });
    return pairing;
  });

  app.post('/api/sync/pair/:code/approve', { preHandler: requireAuth }, async (req, reply) => {
    if (!devices.approvePairing(req.params.code, req.userId)) {
      return reply.code(404).send({ error: 'this code has expired or was already used' });
    }
    return { ok: true };
  });

  app.get('/api/sync/devices', { preHandler: requireAuth }, async (req) => devices.listDevices(req.userId));

  app.delete('/api/sync/devices/:deviceId', { preHandler: requireAuth }, async (req, reply) => {
    if (!(await devices.revokeDevice(req.userId, req.params.deviceId))) {
      return reply.code(404).send({ error: 'computer not found' });
    }
    return reply.code(204).send();
  });

  // Lets a computer that was unlinked say so itself, with only its own token.
  app.delete('/api/sync/device', { ...device, preHandler: requireAuth }, async (req, reply) => {
    await devices.revokeDevice(req.userId, req.deviceId);
    return reply.code(204).send();
  });

  app.get('/api/sync/projects', { ...device, preHandler: requireAuth }, async (req) => {
    const projects = await listProjectsForUser(req.userId);
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      mainFile: p.mainFile,
      compiler: p.compiler,
      role: resolveRole(p, req.userId),
    }));
  });

  // Puts a paper written on a laptop onto the server. Its files follow through
  // the normal sync, so the template file would only get in their way.
  app.post('/api/sync/projects', { ...device, preHandler: requireAuth }, async (req, reply) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return reply.code(400).send({ error: 'name is required' });
    const created = await createProject(req.userId, name);
    await fs.rm(await resolveUserPath(req.userId, created.id, 'main.tex'), { force: true });
    const manifest = await updateManifest(req.userId, created.id, (m) => ({
      ...m,
      files: [],
      mainFile: isSyncablePath(req.body?.mainFile) ? req.body.mainFile : m.mainFile,
      compiler: req.body?.compiler ?? m.compiler,
    }));
    return reply.code(201).send({ id: manifest.id, name: manifest.name, role: 'owner' });
  });

  app.get('/api/sync/projects/:id/state', { ...device, preHandler: requireProjectAccess }, async (req) => {
    await collab.flushProject(req.ownerId, req.params.id);
    const { files, tooLarge } = await listSyncFiles(req.ownerId, req.params.id);
    return {
      name: req.manifest.name,
      mainFile: req.manifest.mainFile,
      compiler: req.manifest.compiler,
      role: req.projectRole,
      files,
      tooLarge,
    };
  });

  // Merges one text file. A viewer may fetch but not send.
  app.post(
    '/api/sync/projects/:id/doc',
    { ...device, bodyLimit, preHandler: requireProjectAccess },
    async (req, reply) => {
      const { path: relPath, stateVector, update, replaceWith } = req.body ?? {};
      if ((update || replaceWith !== undefined) && req.projectRole === 'viewer') {
        return reply.code(403).send({ error: 'read-only access' });
      }
      try {
        const target = await targetFor(req, relPath);
        if (update) {
          await fs.mkdir(path.dirname(target), { recursive: true });
          const handle = await fs.open(target, 'a');
          await handle.close();
          await upsertFileEntry(req.ownerId, req.params.id, relPath);
        }
        if (replaceWith !== undefined) {
          await collab.replaceText(req.ownerId, req.params.id, relPath, String(replaceWith));
        }
        const result = await collab.exchangeDoc(req.ownerId, req.params.id, relPath, {
          stateVector: decode(stateVector),
          update: decode(update),
        });
        return { stateVector: encode(result.stateVector), update: encode(result.update) };
      } catch (err) {
        return reply.code(400).send({ error: err.message });
      }
    }
  );

  app.get('/api/sync/projects/:id/raw', { ...device, preHandler: requireProjectAccess }, async (req, reply) => {
    try {
      const target = await targetFor(req, req.query.path);
      const buffer = await fs.readFile(target);
      return reply.type('application/octet-stream').send(buffer);
    } catch {
      return reply.code(404).send({ error: 'file not found' });
    }
  });

  app.put('/api/sync/projects/:id/raw', { ...device, bodyLimit, preHandler: requireProjectWrite }, async (req, reply) => {
    try {
      const target = await targetFor(req, req.query.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, req.body);
      await upsertFileEntry(req.ownerId, req.params.id, req.query.path);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.delete('/api/sync/projects/:id/raw', { ...device, preHandler: requireProjectWrite }, async (req, reply) => {
    try {
      const target = await targetFor(req, req.query.path);
      await collab.forgetFile(req.ownerId, req.params.id, req.query.path);
      await fs.rm(target, { force: true });
      await removeFileEntry(req.ownerId, req.params.id, req.query.path);
      await syncFilesFromDisk(req.ownerId, req.params.id);
      return reply.code(204).send();
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });
}
