import { ZipArchive } from 'archiver';
import {
  listProjectsForUser,
  createProject,
  readManifest,
  updateManifest,
  deleteProject,
} from '../lib/manifest.js';
import { TEMPLATES } from '../lib/templates.js';
import { projectDir } from '../lib/storage.js';
import { importFromGit } from '../lib/gitImport.js';
import { importFromZip } from '../lib/zipImport.js';
import {
  requireAuth,
  requireProjectAccess,
  requireProjectOwner,
  requireProjectWrite,
  resolveRole,
} from '../lib/authMiddleware.js';
import { findUserByEmail, findUserById } from '../lib/auth.js';
import * as sharedIndex from '../lib/sharedIndex.js';
import * as shareLinks from '../lib/shareLinks.js';

export default async function projectsRoutes(app) {
  app.get('/api/templates', { preHandler: requireAuth }, async () => {
    return Object.entries(TEMPLATES).map(([id, t]) => ({ id, label: t.label }));
  });

  app.get('/api/projects', { preHandler: requireAuth }, async (req) => {
    const projects = await listProjectsForUser(req.userId);
    return projects.map((p) => ({ ...p, yourRole: resolveRole(p, req.userId) }));
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
    return { ...req.manifest, yourRole: req.projectRole };
  });

  app.patch('/api/projects/:id', { preHandler: requireProjectWrite }, async (req) => {
    const { name, mainFile, compiler } = req.body ?? {};
    return updateManifest(req.ownerId, req.params.id, (manifest) => ({
      ...manifest,
      ...(name ? { name } : {}),
      ...(mainFile ? { mainFile } : {}),
      ...(compiler ? { compiler } : {}),
    }));
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

  app.post('/api/projects/:id/share', { preHandler: requireProjectOwner }, async (req, reply) => {
    const { email, role } = req.body ?? {};
    if (!email || typeof email !== 'string') {
      return reply.code(400).send({ error: 'email is required' });
    }
    const user = await findUserByEmail(email.trim());
    if (!user) return reply.code(404).send({ error: 'no account with that email' });
    if (user.id === req.userId) {
      return reply.code(400).send({ error: "can't share a project with yourself" });
    }

    const manifest = await updateManifest(req.ownerId, req.params.id, (current) => {
      const collaborators = current.collaborators ?? [];
      if (collaborators.some((c) => c.userId === user.id)) return current;
      return {
        ...current,
        collaborators: [
          ...collaborators,
          { userId: user.id, email: user.email, role: role === 'viewer' ? 'viewer' : 'editor' },
        ],
      };
    });
    await sharedIndex.addShare(user.id, req.params.id, req.ownerId);
    return manifest;
  });

  app.post('/api/projects/:id/unshare', { preHandler: requireProjectOwner }, async (req, reply) => {
    const { userId } = req.body ?? {};
    if (!userId || typeof userId !== 'string') {
      return reply.code(400).send({ error: 'userId is required' });
    }
    const manifest = await updateManifest(req.ownerId, req.params.id, (current) => ({
      ...current,
      collaborators: (current.collaborators ?? []).filter((c) => c.userId !== userId),
    }));
    await sharedIndex.removeShare(userId, req.params.id);
    return manifest;
  });

  app.post('/api/projects/:id/collaborators/:userId/role', { preHandler: requireProjectOwner }, async (req, reply) => {
    const { role } = req.body ?? {};
    if (role !== 'editor' && role !== 'viewer') {
      return reply.code(400).send({ error: "role must be 'editor' or 'viewer'" });
    }
    if (!(req.manifest.collaborators ?? []).some((c) => c.userId === req.params.userId)) {
      return reply.code(404).send({ error: 'not a collaborator on this project' });
    }
    return updateManifest(req.ownerId, req.params.id, (current) => ({
      ...current,
      collaborators: (current.collaborators ?? []).map((c) =>
        c.userId === req.params.userId ? { ...c, role } : c
      ),
    }));
  });

  app.post('/api/projects/:id/share-links', { preHandler: requireProjectOwner }, async (req, reply) => {
    const { role } = req.body ?? {};
    const finalRole = role === 'viewer' ? 'viewer' : 'editor';
    const link = await shareLinks.createShareLink(req.params.id, req.ownerId, finalRole);
    return reply.code(201).send({ token: link.token, role: link.role });
  });

  app.get('/api/projects/:id/share-links', { preHandler: requireProjectOwner }, async (req) => {
    return shareLinks.listShareLinks(req.params.id);
  });

  app.delete('/api/projects/:id/share-links/:token', { preHandler: requireProjectOwner }, async (req, reply) => {
    const ok = await shareLinks.revokeShareLink(req.params.id, req.params.token);
    if (!ok) return reply.code(404).send({ error: 'share link not found' });
    return reply.code(204).send();
  });

  // Redemption — any authenticated user, not just the project owner, so
  // it needs its own auth-only guard rather than requireProjectAccess
  // (which would 403 before the link has a chance to grant access).
  app.post('/api/share-links/:token/join', { preHandler: requireAuth }, async (req, reply) => {
    const link = await shareLinks.findShareLink(req.params.token);
    if (!link) return reply.code(404).send({ error: 'invite link not found or revoked' });

    let manifest;
    try {
      manifest = await readManifest(link.ownerId, link.projectId);
    } catch {
      return reply.code(404).send({ error: 'project no longer exists' });
    }

    if (manifest.ownerId === req.userId) {
      // Owner following their own link — nothing to do.
      return { projectId: link.projectId };
    }

    const user = await findUserById(req.userId);
    // Re-read and mutate under the manifest's lock: several people redeeming
    // the same link at once would otherwise each write a collaborator list
    // built from the same stale read, and all but the last would be silently
    // dropped — leaving them with a link that appeared to work but no access.
    let joined = false;
    await updateManifest(link.ownerId, link.projectId, (current) => {
      const collaborators = current.collaborators ?? [];
      const existing = collaborators.find((c) => c.userId === req.userId);
      if (existing) {
        // Idempotent join — never downgrade an existing editor to viewer.
        if (existing.role === 'viewer' && link.role === 'editor') {
          return {
            ...current,
            collaborators: collaborators.map((c) =>
              c.userId === req.userId ? { ...c, role: 'editor' } : c
            ),
          };
        }
        return current;
      }
      joined = true;
      return {
        ...current,
        collaborators: [
          ...collaborators,
          { userId: req.userId, email: user?.email ?? '', role: link.role },
        ],
      };
    });
    if (joined) await sharedIndex.addShare(req.userId, link.projectId, link.ownerId);
    return { projectId: link.projectId };
  });
}
