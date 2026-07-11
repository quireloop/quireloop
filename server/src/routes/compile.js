import fs from 'node:fs';
import { compileProject, cleanProject } from '../lib/latex.js';
import { resolveProjectPath } from '../lib/storage.js';
import { createSnapshot } from '../lib/versions.js';
import { requireProjectAccess } from '../lib/authMiddleware.js';

export default async function compileRoutes(app) {
  app.post('/api/projects/:id/compile', { preHandler: requireProjectAccess }, async (req) => {
    const manifest = req.manifest;
    const result = await compileProject(req.ownerId, req.params.id, manifest.mainFile, manifest.compiler);
    if (result.success) {
      await createSnapshot(req.ownerId, req.params.id, { trigger: 'compile' });
    }
    return result;
  });

  app.post('/api/projects/:id/clean', { preHandler: requireProjectAccess }, async (req) => {
    return cleanProject(req.ownerId, req.params.id, req.manifest.mainFile);
  });

  app.get('/api/projects/:id/pdf', { preHandler: requireProjectAccess }, async (req, reply) => {
    try {
      const pdfName = req.manifest.mainFile.replace(/\.tex$/, '.pdf');
      const pdfPath = resolveProjectPath(req.ownerId, req.params.id, `build/${pdfName}`);
      fs.accessSync(pdfPath);
      return reply.type('application/pdf').send(fs.createReadStream(pdfPath));
    } catch {
      return reply.code(404).send({ error: 'pdf not found — compile the project first' });
    }
  });
}
