import { ZipArchive } from 'archiver';
import { listProjects, createProject, readManifest, writeManifest, deleteProject } from '../lib/manifest.js';
import { TEMPLATES } from '../lib/templates.js';
import { projectDir } from '../lib/storage.js';
import { importFromGit } from '../lib/gitImport.js';
import { importFromZip } from '../lib/zipImport.js';
import { requireAuth, requireProjectAccess, requireProjectOwner } from '../lib/authMiddleware.js';

export default async function projectsRoutes(app) {
  app.get('/api/templates', { preHandler: requireAuth }, async () => {
    return Object.entries(TEMPLATES).map(([id, t]) => ({ id, label: t.label }));
  });

  app.get('/api/projects', { preHandler: requireAuth }, async (req) => {
    return listProjects(req.userId);
  });

  app.post('/api/projects', { preHandler: requireAuth }, async (req, reply) => {
    const { name, templateId } = req.body ?? {};
    if (!name || typeof name !== 'string') {
      return reply.code(400).send({ error: 'name is required' });
    }
    const manifest = await createProject(req.userId, name, templateId);
    return reply.code(201).send(manifest);
  });

  app.post('/api/projects/import-git', { preHandler: requireAuth }, async (req, reply) => {
    const { name, gitUrl, token } = req.body ?? {};
    if (!gitUrl || typeof gitUrl !== 'string') {
      return reply.code(400).send({ error: 'a git URL is required' });
    }
    try {
      const manifest = await importFromGit(req.userId, name, gitUrl, token);
      return reply.code(201).send(manifest);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/projects/upload-zip', { preHandler: requireAuth }, async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'no file uploaded' });
    const buffer = await data.toBuffer();
    try {
      const manifest = await importFromZip(req.userId, req.query?.name, buffer);
      return reply.code(201).send(manifest);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.get('/api/projects/:id', { preHandler: requireProjectAccess }, async (req) => {
    return req.manifest;
  });

  app.patch('/api/projects/:id', { preHandler: requireProjectAccess }, async (req) => {
    const manifest = req.manifest;
    const { name, mainFile, compiler } = req.body ?? {};
    if (name) manifest.name = name;
    if (mainFile) manifest.mainFile = mainFile;
    if (compiler) manifest.compiler = compiler;
    return writeManifest(req.ownerId, req.params.id, manifest);
  });

  app.delete('/api/projects/:id', { preHandler: requireProjectOwner }, async (req, reply) => {
    await deleteProject(req.ownerId, req.params.id);
    return reply.code(204).send();
  });

  app.get('/api/projects/:id/download', { preHandler: requireProjectAccess }, async (req, reply) => {
    const manifest = req.manifest;
    const dir = projectDir(req.ownerId, req.params.id);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    reply.header('content-type', 'application/zip');
    reply.header('content-disposition', `attachment; filename="${manifest.name.replace(/[^\w.-]/g, '_')}.zip"`);
    reply.send(archive);
    archive.glob('**/*', { cwd: dir, ignore: ['build/**', 'versions/**', 'manifest.json'] });
    await archive.finalize();
  });
}
