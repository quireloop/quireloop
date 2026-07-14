import fs from 'node:fs/promises';
import {
  createSnapshot,
  listVersions,
  restoreVersion,
  listSnapshotFiles,
  resolveSnapshotFilePath,
} from '../lib/versions.js';
import { requireProjectAccess, requireProjectWrite } from '../lib/authMiddleware.js';
import * as collab from '../lib/collab.js';

export default async function versionsRoutes(app) {
  app.get('/api/projects/:id/versions', { preHandler: requireProjectAccess }, async (req) => {
    return listVersions(req.ownerId, req.params.id);
  });

  // Read-only inspection of a snapshot's contents, for the version diff view
  // — never writes, so both roles get it via requireProjectAccess rather
  // than requireProjectWrite.
  app.get('/api/projects/:id/versions/:versionId/files', { preHandler: requireProjectAccess }, async (req, reply) => {
    try {
      return await listSnapshotFiles(req.ownerId, req.params.id, req.params.versionId);
    } catch (err) {
      return reply.code(404).send({ error: err.message });
    }
  });

  app.get('/api/projects/:id/versions/:versionId/file', { preHandler: requireProjectAccess }, async (req, reply) => {
    const relPath = (req.query?.path ?? '').toString();
    if (!relPath) return reply.code(400).send({ error: 'path is required' });
    try {
      const filePath = resolveSnapshotFilePath(req.ownerId, req.params.id, req.params.versionId, relPath);
      const content = await fs.readFile(filePath, 'utf8');
      return reply.type('text/plain').send(content);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/projects/:id/versions', { preHandler: requireProjectWrite }, async (req) => {
    const { label } = req.body ?? {};
    await collab.flushProject(req.ownerId, req.params.id);
    return createSnapshot(req.ownerId, req.params.id, { label, trigger: 'manual' });
  });

  app.post('/api/projects/:id/versions/:versionId/restore', { preHandler: requireProjectWrite }, async (req, reply) => {
    try {
      const result = await restoreVersion(req.ownerId, req.params.id, req.params.versionId);
      collab.invalidateProject(req.ownerId, req.params.id);
      return result;
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });
}
