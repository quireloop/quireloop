import { gitStatus, gitCommit, setRemote, pushProject, pullProject } from '../lib/projectGit.js';
import { syncFilesFromDisk } from '../lib/manifest.js';
import { requireProjectAccess } from '../lib/authMiddleware.js';

export default async function gitRoutes(app) {
  app.get('/api/projects/:id/git/status', { preHandler: requireProjectAccess }, async (req, reply) => {
    try {
      return await gitStatus(req.ownerId, req.params.id);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/projects/:id/git/commit', { preHandler: requireProjectAccess }, async (req, reply) => {
    const { message } = req.body ?? {};
    try {
      return await gitCommit(req.ownerId, req.params.id, message);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/projects/:id/git/remote', { preHandler: requireProjectAccess }, async (req, reply) => {
    const { url, token } = req.body ?? {};
    if (!url) return reply.code(400).send({ error: 'a git URL is required' });
    try {
      return await setRemote(req.ownerId, req.params.id, url, token);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/projects/:id/git/push', { preHandler: requireProjectAccess }, async (req, reply) => {
    try {
      return await pushProject(req.ownerId, req.params.id);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/projects/:id/git/pull', { preHandler: requireProjectAccess }, async (req, reply) => {
    try {
      const result = await pullProject(req.ownerId, req.params.id);
      await syncFilesFromDisk(req.ownerId, req.params.id);
      return result;
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });
}
