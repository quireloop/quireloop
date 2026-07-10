import fs from 'node:fs';
import { compileProject, cleanProject } from '../lib/latex.js';
import { resolveProjectPath } from '../lib/storage.js';
import { createSnapshot } from '../lib/versions.js';
import { readManifest } from '../lib/manifest.js';

export default async function compileRoutes(app) {
  app.post('/api/projects/:id/compile', async (req) => {
    const manifest = await readManifest(req.params.id);
    const result = await compileProject(req.params.id, manifest.mainFile, manifest.compiler);
    if (result.success) {
      await createSnapshot(req.params.id, { trigger: 'compile' });
    }
    return result;
  });

  app.post('/api/projects/:id/clean', async (req) => {
    const manifest = await readManifest(req.params.id);
    return cleanProject(req.params.id, manifest.mainFile);
  });

  app.get('/api/projects/:id/pdf', async (req, reply) => {
    try {
      const manifest = await readManifest(req.params.id);
      const pdfName = manifest.mainFile.replace(/\.tex$/, '.pdf');
      const pdfPath = resolveProjectPath(req.params.id, `build/${pdfName}`);
      fs.accessSync(pdfPath);
      return reply.type('application/pdf').send(fs.createReadStream(pdfPath));
    } catch {
      return reply.code(404).send({ error: 'pdf not found — compile the project first' });
    }
  });
}
