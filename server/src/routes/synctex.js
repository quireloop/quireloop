import { toSource, toPdf } from '../lib/synctex.js';
import { requireProjectAccess } from '../lib/authMiddleware.js';

// Both values end up inside a single synctex argument ("page:x:y:file" /
// "line:col:file"), so anything that isn't a plain number — or a file name
// carrying a colon or newline — is refused before it gets there.
const isCoord = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isLine = (v) => Number.isInteger(v) && v > 0;
const isFileName = (v) => typeof v === 'string' && v.length > 0 && v.length < 1024 && !/[:\n\r\0]/.test(v);

export default async function synctexRoutes(app) {
  app.post('/api/projects/:id/synctex/to-source', { preHandler: requireProjectAccess }, async (req, reply) => {
    const { page, x, y } = req.body ?? {};
    if (!isLine(page) || !isCoord(x) || !isCoord(y)) {
      return reply.code(400).send({ error: 'page, x and y must be numbers' });
    }
    const result = await toSource(req.ownerId, req.params.id, req.manifest.mainFile, page, x, y);
    if (!result) return reply.code(404).send({ error: 'no matching source position' });
    return result;
  });

  app.post('/api/projects/:id/synctex/to-pdf', { preHandler: requireProjectAccess }, async (req, reply) => {
    const { file, line } = req.body ?? {};
    if (!isFileName(file) || !isLine(line)) {
      return reply.code(400).send({ error: 'file and line are required' });
    }
    const result = await toPdf(req.ownerId, req.params.id, req.manifest.mainFile, file, line);
    if (!result) return reply.code(404).send({ error: 'no matching pdf position' });
    return result;
  });
}
