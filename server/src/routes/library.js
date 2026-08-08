import { requireAuth } from '../lib/authMiddleware.js';
import { findUserById } from '../lib/auth.js';
import { libraryEnabled, listDirectory, resolveInLibrary, rootsForUser } from '../lib/library.js';
import { linkProject } from '../lib/manifest.js';

// Browsing the host's filesystem and opening a folder in place. Every path
// here is validated by lib/library.js against the operator's allowlist — see
// the note at the top of that file for why nothing may bypass it.
export default async function libraryRoutes(app) {
  // The UI hides the "Open a folder" affordance entirely when this is false,
  // so it must answer for a logged-in user even when the feature is off.
  app.get('/api/library/roots', { preHandler: requireAuth }, async (req) => {
    if (!libraryEnabled()) return { enabled: false, roots: [] };
    const user = await findUserById(req.userId);
    const roots = await rootsForUser(user);
    return { enabled: true, roots: roots.map((r) => ({ label: r.label, path: r.realPath })) };
  });

  app.get('/api/library/browse', { preHandler: requireAuth }, async (req, reply) => {
    const user = await findUserById(req.userId);
    try {
      return await listDirectory(user, req.query?.path);
    } catch (err) {
      return reply.code(err.statusCode ?? 400).send({ error: err.message });
    }
  });

  app.post('/api/projects/open-folder', { preHandler: requireAuth }, async (req, reply) => {
    const { path: requestedPath, name } = req.body ?? {};
    const user = await findUserById(req.userId);

    let realPath;
    try {
      ({ realPath } = await resolveInLibrary(user, requestedPath));
    } catch (err) {
      return reply.code(err.statusCode ?? 400).send({ error: err.message });
    }

    try {
      const manifest = await linkProject(req.userId, realPath, typeof name === 'string' ? name.trim() : '');
      return reply.code(201).send(manifest);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });
}
