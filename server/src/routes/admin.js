import { listUsers, findUserById, updateUser, publicUser } from '../lib/auth.js';
import { createInvite, listInvites, revokeInvite } from '../lib/invites.js';
import { requireAdmin } from '../lib/authMiddleware.js';
import { getSettings, updateSettings } from '../lib/settings.js';
import { DEFAULT_ASSISTANT_MODEL } from './assistant.js';

// The API key is a secret — never echo it back in full. The masked form is
// enough for the admin to recognize which key is configured.
function maskKey(key) {
  if (!key) return null;
  return key.length > 8 ? `${key.slice(0, 7)}…${key.slice(-4)}` : '••••';
}

export default async function adminRoutes(app) {
  app.get('/api/admin/settings', { preHandler: requireAdmin }, async () => {
    const s = await getSettings();
    const envKey = process.env.QUIRELOOP_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';
    return {
      anthropicApiKey: maskKey(s.anthropicApiKey),
      assistantModel: s.assistantModel || DEFAULT_ASSISTANT_MODEL,
      // When the key comes from the environment, the UI field is informational
      // only — env always wins so ops-managed deployments stay deterministic.
      keyFromEnv: Boolean(envKey),
    };
  });

  app.post('/api/admin/settings', { preHandler: requireAdmin }, async (req, reply) => {
    const { anthropicApiKey, assistantModel } = req.body ?? {};
    const patch = {};
    if (anthropicApiKey !== undefined) {
      if (anthropicApiKey !== '' && anthropicApiKey !== null && !/^sk-ant-/.test(anthropicApiKey)) {
        return reply.code(400).send({ error: 'that does not look like an Anthropic API key (they start with sk-ant-)' });
      }
      patch.anthropicApiKey = anthropicApiKey;
    }
    if (assistantModel !== undefined) {
      if (assistantModel !== '' && assistantModel !== null && !/^[a-z0-9.-]+$/.test(assistantModel)) {
        return reply.code(400).send({ error: 'invalid model id' });
      }
      patch.assistantModel = assistantModel;
    }
    await updateSettings(patch);
    return { ok: true };
  });

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
