import fs from 'node:fs';
import path from 'node:path';
import { compileProject, cleanProject, pdfPathFor } from '../lib/latex.js';
import { parseLatexLog } from '../lib/latexLog.js';
import { projectDir, resolveUserPath } from '../lib/storage.js';
import { createSnapshot } from '../lib/versions.js';
import { requireProjectAccess, requireProjectWrite } from '../lib/authMiddleware.js';
import * as collab from '../lib/collab.js';

const MAX_LOG_BYTES = 8 * 1024 * 1024;

// LaTeX's own log from the last pass. latexmk's output holds every pass, and
// the first pass of a fresh paper warns about each reference it hasn't seen
// yet, which later passes resolve: read from there, a new paper showed a
// dozen problems that were already gone. The build folder is written by the
// paper's own compile, so a link planted there is not followed.
async function finalLog(ownerId, projectId, mainFile) {
  const file = path.join(projectDir(ownerId, projectId), 'build', `${path.basename(mainFile, '.tex')}.log`);
  const stat = await fs.promises.lstat(file).catch(() => null);
  if (!stat?.isFile() || stat.size > MAX_LOG_BYTES) return null;
  return fs.promises.readFile(file, 'latin1').catch(() => null);
}

export default async function compileRoutes(app) {
  app.post('/api/projects/:id/compile', { preHandler: requireProjectAccess }, async (req) => {
    const manifest = req.manifest;
    await collab.flushProject(req.ownerId, req.params.id);
    const result = await compileProject(req.ownerId, req.params.id, manifest.mainFile, manifest.compiler);
    const log = (await finalLog(req.ownerId, req.params.id, manifest.mainFile)) ?? result.log;
    const problems = parseLatexLog(log, manifest.mainFile);
    if (result.success) {
      await createSnapshot(req.ownerId, req.params.id, { trigger: 'compile' });
    }
    return { ...result, problems };
  });

  // Deleting the build directory changes project state, so it needs write
  // access — a viewer is read-only and must not be able to wipe it.
  app.post('/api/projects/:id/clean', { preHandler: requireProjectWrite }, async (req) => {
    return cleanProject(req.ownerId, req.params.id, req.manifest.mainFile);
  });

  app.get('/api/projects/:id/pdf', { preHandler: requireProjectAccess }, async (req, reply) => {
    try {
      const pdfPath = await resolveUserPath(req.ownerId, req.params.id, pdfPathFor(req.manifest.mainFile));
      fs.accessSync(pdfPath);
      // O_NOFOLLOW because a running compile can still swap this file for a link.
      const flags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW;
      return reply.type('application/pdf').send(fs.createReadStream(pdfPath, { flags }));
    } catch {
      return reply.code(404).send({ error: 'pdf not found — compile the project first' });
    }
  });
}
