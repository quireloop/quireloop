import { toSource, toPdf } from '../lib/synctex.js';
import { readManifest } from '../lib/manifest.js';

export default async function synctexRoutes(app) {
  app.post('/api/projects/:id/synctex/to-source', async (req, reply) => {
    const { page, x, y } = req.body ?? {};
    const manifest = await readManifest(req.params.id);
    const result = await toSource(req.params.id, manifest.mainFile, page, x, y);
    if (!result) return reply.code(404).send({ error: 'no matching source position' });
    return result;
  });

  app.post('/api/projects/:id/synctex/to-pdf', async (req, reply) => {
    const { file, line } = req.body ?? {};
    const manifest = await readManifest(req.params.id);
    const result = await toPdf(req.params.id, manifest.mainFile, file, line);
    if (!result) return reply.code(404).send({ error: 'no matching pdf position' });
    return result;
  });
}
