import { ZipArchive } from 'archiver';
import { listProjects, createProject, readManifest, writeManifest, deleteProject } from '../lib/manifest.js';
import { TEMPLATES } from '../lib/templates.js';
import { projectDir } from '../lib/storage.js';
import { importFromGit } from '../lib/gitImport.js';

export default async function projectsRoutes(app) {
  app.get('/api/templates', async () => {
    return Object.entries(TEMPLATES).map(([id, t]) => ({ id, label: t.label }));
  });

  app.get('/api/projects', async () => {
    return listProjects();
  });

  app.post('/api/projects', async (req, reply) => {
    const { name, templateId } = req.body ?? {};
    if (!name || typeof name !== 'string') {
      return reply.code(400).send({ error: 'name is required' });
    }
    const manifest = await createProject(name, templateId);
    return reply.code(201).send(manifest);
  });

  app.post('/api/projects/import-git', async (req, reply) => {
    const { name, gitUrl, token } = req.body ?? {};
    if (!gitUrl || typeof gitUrl !== 'string') {
      return reply.code(400).send({ error: 'a git URL is required' });
    }
    try {
      const manifest = await importFromGit(name, gitUrl, token);
      return reply.code(201).send(manifest);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.get('/api/projects/:id', async (req) => {
    return readManifest(req.params.id);
  });

  app.patch('/api/projects/:id', async (req) => {
    const manifest = await readManifest(req.params.id);
    const { name, mainFile, compiler } = req.body ?? {};
    if (name) manifest.name = name;
    if (mainFile) manifest.mainFile = mainFile;
    if (compiler) manifest.compiler = compiler;
    return writeManifest(req.params.id, manifest);
  });

  app.delete('/api/projects/:id', async (req, reply) => {
    await deleteProject(req.params.id);
    return reply.code(204).send();
  });

  app.get('/api/projects/:id/download', async (req, reply) => {
    const manifest = await readManifest(req.params.id);
    const dir = projectDir(req.params.id);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    reply.header('content-type', 'application/zip');
    reply.header('content-disposition', `attachment; filename="${manifest.name.replace(/[^\w.-]/g, '_')}.zip"`);
    reply.send(archive);
    archive.glob('**/*', { cwd: dir, ignore: ['build/**', 'versions/**', 'manifest.json'] });
    await archive.finalize();
  });
}
