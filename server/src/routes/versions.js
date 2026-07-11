import { createSnapshot, listVersions, restoreVersion } from '../lib/versions.js';
import { requireProjectAccess } from '../lib/authMiddleware.js';

export default async function versionsRoutes(app) {
  app.get('/api/projects/:id/versions', { preHandler: requireProjectAccess }, async (req) => {
    return listVersions(req.ownerId, req.params.id);
  });

  app.post('/api/projects/:id/versions', { preHandler: requireProjectAccess }, async (req) => {
    const { label } = req.body ?? {};
    return createSnapshot(req.ownerId, req.params.id, { label, trigger: 'manual' });
  });

  app.post('/api/projects/:id/versions/:versionId/restore', { preHandler: requireProjectAccess }, async (req, reply) => {
    try {
      return await restoreVersion(req.ownerId, req.params.id, req.params.versionId);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });
}
