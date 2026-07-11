import { createSnapshot, listVersions, restoreVersion } from '../lib/versions.js';
import { requireProjectAccess } from '../lib/authMiddleware.js';
import * as collab from '../lib/collab.js';

export default async function versionsRoutes(app) {
  app.get('/api/projects/:id/versions', { preHandler: requireProjectAccess }, async (req) => {
    return listVersions(req.ownerId, req.params.id);
  });

  app.post('/api/projects/:id/versions', { preHandler: requireProjectAccess }, async (req) => {
    const { label } = req.body ?? {};
    await collab.flushProject(req.ownerId, req.params.id);
    return createSnapshot(req.ownerId, req.params.id, { label, trigger: 'manual' });
  });

  app.post('/api/projects/:id/versions/:versionId/restore', { preHandler: requireProjectAccess }, async (req, reply) => {
    try {
      const result = await restoreVersion(req.ownerId, req.params.id, req.params.versionId);
      collab.invalidateProject(req.ownerId, req.params.id);
      return result;
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });
}
