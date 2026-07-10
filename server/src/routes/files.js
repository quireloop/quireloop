import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveProjectPath } from '../lib/storage.js';
import { upsertFileEntry, removeFileEntry, renameFileEntry } from '../lib/manifest.js';

export default async function filesRoutes(app) {
  app.get('/api/projects/:id/files/*', async (req, reply) => {
    try {
      const filePath = resolveProjectPath(req.params.id, req.params['*']);
      const content = await fs.readFile(filePath, 'utf8');
      return reply.type('text/plain').send(content);
    } catch {
      return reply.code(404).send({ error: 'file not found' });
    }
  });

  app.put('/api/projects/:id/files/*', async (req, reply) => {
    const relPath = req.params['*'];
    try {
      const filePath = resolveProjectPath(req.params.id, relPath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const body = typeof req.body === 'string' ? req.body : (req.body?.content ?? '');
      await fs.writeFile(filePath, body);
      await upsertFileEntry(req.params.id, relPath);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.delete('/api/projects/:id/files/*', async (req, reply) => {
    const relPath = req.params['*'];
    try {
      const filePath = resolveProjectPath(req.params.id, relPath);
      await fs.rm(filePath, { force: true });
      await removeFileEntry(req.params.id, relPath);
      return reply.code(204).send();
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/projects/:id/rename', async (req, reply) => {
    const { oldPath, newPath } = req.body ?? {};
    if (!oldPath || !newPath) {
      return reply.code(400).send({ error: 'oldPath and newPath are required' });
    }
    try {
      const from = resolveProjectPath(req.params.id, oldPath);
      const to = resolveProjectPath(req.params.id, newPath);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
      await renameFileEntry(req.params.id, oldPath, newPath);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/projects/:id/folders', async (req, reply) => {
    const { path: folderPath } = req.body ?? {};
    if (!folderPath) return reply.code(400).send({ error: 'path is required' });
    try {
      const dirPath = resolveProjectPath(req.params.id, folderPath);
      await fs.mkdir(dirPath, { recursive: true });
      await upsertFileEntry(req.params.id, folderPath, { type: 'folder' });
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/projects/:id/upload', async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'no file uploaded' });

    const relPath = path.join('figures', data.filename);
    const filePath = resolveProjectPath(req.params.id, relPath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const buffer = await data.toBuffer();
    await fs.writeFile(filePath, buffer);
    await upsertFileEntry(req.params.id, relPath, { size: buffer.length, mime: data.mimetype });

    return { ok: true, path: relPath, size: buffer.length };
  });
}
