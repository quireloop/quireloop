import { toSource, toPdf } from '../lib/synctex.js';
import { requireProjectAccess } from '../lib/authMiddleware.js';

export default async function synctexRoutes(app) {
  app.post('/api/projects/:id/synctex/to-source', { preHandler: requireProjectAccess }, async (req, reply) => {
    const { page, x, y } = req.body ?? {};
    const result = await toSource(req.ownerId, req.params.id, req.manifest.mainFile, page, x, y);
    if (!result) return reply.code(404).send({ error: 'no matching source position' });
    return result;
  });

  app.post('/api/projects/:id/synctex/to-pdf', { preHandler: requireProjectAccess }, async (req, reply) => {
    const { file, line } = req.body ?? {};
    const result = await toPdf(req.ownerId, req.params.id, req.manifest.mainFile, file, line);
    if (!result) return reply.code(404).send({ error: 'no matching pdf position' });
    return result;
  });
}
