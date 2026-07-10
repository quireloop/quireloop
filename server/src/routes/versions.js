import { createSnapshot, listVersions, restoreVersion } from '../lib/versions.js';

export default async function versionsRoutes(app) {
  app.get('/api/projects/:id/versions', async (req) => {
    return listVersions(req.params.id);
  });

  app.post('/api/projects/:id/versions', async (req) => {
    const { label } = req.body ?? {};
    return createSnapshot(req.params.id, { label, trigger: 'manual' });
  });

  app.post('/api/projects/:id/versions/:versionId/restore', async (req, reply) => {
    try {
      return await restoreVersion(req.params.id, req.params.versionId);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });
}
