import { listUsers, findUserById, updateUser, publicUser } from '../lib/auth.js';
import { createInvite, listInvites, revokeInvite } from '../lib/invites.js';
import { requireAdmin } from '../lib/authMiddleware.js';

export default async function adminRoutes(app) {
  app.get('/api/admin/users', { preHandler: requireAdmin }, async () => {
    const users = await listUsers();
    return users.map((u) => ({ ...publicUser(u), disabled: Boolean(u.disabled), createdAt: u.createdAt }));
  });

  app.post('/api/admin/users/:id/disable', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params;
    if (id === req.userId) {
      return reply.code(400).send({ error: 'you cannot disable your own account' });
    }
    const user = await findUserById(id);
    if (!user) return reply.code(404).send({ error: 'user not found' });
    await updateUser(id, { disabled: true });
    return { ok: true };
  });

  app.post('/api/admin/users/:id/enable', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params;
    const user = await findUserById(id);
    if (!user) return reply.code(404).send({ error: 'user not found' });
    await updateUser(id, { disabled: false });
    return { ok: true };
  });

  app.post('/api/admin/invites', { preHandler: requireAdmin }, async (req) => {
    const invite = await createInvite(req.userId);
    return { code: invite.code };
  });

  app.get('/api/admin/invites', { preHandler: requireAdmin }, async () => {
    return listInvites();
  });

  app.delete('/api/admin/invites/:code', { preHandler: requireAdmin }, async (req, reply) => {
    const ok = await revokeInvite(req.params.code);
    if (!ok) return reply.code(400).send({ error: 'invite not found or already used' });
    return reply.code(204).send();
  });
}
