import {
  createUser,
  deleteUser,
  findUserByEmail,
  findUserById,
  updateUser,
  verifyPassword,
  hashPassword,
  publicUser,
  maskedAssistantSettings,
  signTempToken,
  verifyTempToken,
  usersExist,
} from '../lib/auth.js';
import { createSecret, checkCode, enrollmentDetails } from '../lib/twoFactor.js';
import { requireAuth } from '../lib/authMiddleware.js';
import { consumeInvite, isInviteValid } from '../lib/invites.js';
import { registerFailure, isBlocked, clear } from '../lib/rateLimit.js';

// Open signup is only possible for the very first account (bootstrapping
// a fresh deployment) or when the operator explicitly opts back in.
async function inviteRequired() {
  if (process.env.QUIRELOOP_OPEN_SIGNUP === 'true') return false;
  return usersExist();
}

function tooManyAttempts(reply, seconds) {
  reply.header('Retry-After', String(seconds));
  return reply.code(429).send({ error: `too many attempts, retry in ${seconds} seconds` });
}

export default async function authRoutes(app) {
  app.get('/api/auth/config', async () => {
    return { inviteRequired: await inviteRequired() };
  });

  app.post('/api/auth/signup', async (req, reply) => {
    const { email, password, inviteCode } = req.body ?? {};
    const ipKey = `signup-ip:${req.ip}`;
    const emailKey = `signup-email:${(email ?? '').toLowerCase()}`;
    const ipBlocked = isBlocked(ipKey);
    const emailBlocked = isBlocked(emailKey);
    if (ipBlocked || emailBlocked) {
      return tooManyAttempts(reply, Math.max(ipBlocked || 0, emailBlocked || 0));
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      registerFailure(ipKey);
      return reply.code(400).send({ error: 'a valid email is required' });
    }
    if (!password || password.length < 8) {
      registerFailure(ipKey);
      return reply.code(400).send({ error: 'password must be at least 8 characters' });
    }

    const needsInvite = await inviteRequired();
    if (needsInvite) {
      if (!inviteCode || typeof inviteCode !== 'string' || !(await isInviteValid(inviteCode))) {
        registerFailure(ipKey);
        registerFailure(emailKey);
        return reply.code(403).send({ error: 'invalid or already-used invite code' });
      }
    }

    let user;
    try {
      user = await createUser(email, password);
    } catch (err) {
      registerFailure(ipKey);
      registerFailure(emailKey);
      return reply.code(400).send({ error: err.message });
    }
    clear(ipKey);
    clear(emailKey);
    if (needsInvite) {
      // Atomic check-and-mark now that we know the new user's id — closes
      // the race where two signups redeem the same code between the peek
      // above and here.
      const redeemed = await consumeInvite(inviteCode, user.id);
      if (!redeemed) {
        // The account was already created — remove it, or the race loser
        // would keep a working login despite never redeeming an invite.
        await deleteUser(user.id);
        return reply.code(403).send({ error: 'invite code was already used, try again' });
      }
    }
    req.session.set('userId', user.id);
    return reply.code(201).send(publicUser(user));
  });

  app.post('/api/auth/login', async (req, reply) => {
    const { email, password } = req.body ?? {};
    const ipKey = `ip:${req.ip}`;
    const emailKey = `email:${(email ?? '').toLowerCase()}`;

    const ipBlocked = isBlocked(ipKey);
    const emailBlocked = isBlocked(emailKey);
    if (ipBlocked || emailBlocked) {
      return tooManyAttempts(reply, Math.max(ipBlocked || 0, emailBlocked || 0));
    }

    const user = await findUserByEmail(email ?? '');
    if (!user || !(await verifyPassword(password ?? '', user.passwordHash))) {
      registerFailure(ipKey);
      registerFailure(emailKey);
      return reply.code(401).send({ error: 'invalid email or password' });
    }
    if (user.disabled) {
      return reply.code(403).send({ error: 'this account has been disabled' });
    }
    if (user.twoFactorEnabled) {
      return { needsTwoFactor: true, tempToken: signTempToken(user.id) };
    }
    clear(ipKey);
    clear(emailKey);
    req.session.set('userId', user.id);
    return publicUser(user);
  });

  app.post('/api/auth/login/2fa', async (req, reply) => {
    const { tempToken, code } = req.body ?? {};
    const userId = verifyTempToken(tempToken ?? '');
    if (!userId) return reply.code(401).send({ error: 'login attempt expired, please try again' });
    const user = await findUserById(userId);
    if (!user?.twoFactorEnabled) return reply.code(400).send({ error: '2FA is not enabled for this account' });

    const ipKey = `ip:${req.ip}`;
    const emailKey = `email:${user.email.toLowerCase()}`;
    const ipBlocked = isBlocked(ipKey);
    const emailBlocked = isBlocked(emailKey);
    if (ipBlocked || emailBlocked) {
      return tooManyAttempts(reply, Math.max(ipBlocked || 0, emailBlocked || 0));
    }

    if (!(await checkCode(user.twoFactorSecret, code))) {
      registerFailure(ipKey);
      registerFailure(emailKey);
      return reply.code(401).send({ error: 'invalid code' });
    }
    if (user.disabled) {
      return reply.code(403).send({ error: 'this account has been disabled' });
    }
    clear(ipKey);
    clear(emailKey);
    req.session.set('userId', user.id);
    return publicUser(user);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    req.session.delete();
    return reply.code(204).send();
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req, reply) => {
    const user = await findUserById(req.userId);
    if (!user) return reply.code(401).send({ error: 'not authenticated' });
    return publicUser(user);
  });

  app.post('/api/auth/change-password', { preHandler: requireAuth }, async (req, reply) => {
    const { currentPassword, newPassword } = req.body ?? {};
    const user = await findUserById(req.userId);
    if (!(await verifyPassword(currentPassword ?? '', user.passwordHash))) {
      return reply.code(401).send({ error: 'current password is incorrect' });
    }
    if (!newPassword || newPassword.length < 8) {
      return reply.code(400).send({ error: 'new password must be at least 8 characters' });
    }
    await updateUser(req.userId, { passwordHash: await hashPassword(newPassword) });
    return { ok: true };
  });

  app.post('/api/auth/2fa/setup', { preHandler: requireAuth }, async (req) => {
    const secret = createSecret();
    const user = await findUserById(req.userId);
    await updateUser(req.userId, { pendingTwoFactorSecret: secret });
    const { uri, qrDataUrl } = await enrollmentDetails(user.email, secret);
    return { uri, qrDataUrl };
  });

  app.post('/api/auth/2fa/verify', { preHandler: requireAuth }, async (req, reply) => {
    const { code } = req.body ?? {};
    const user = await findUserById(req.userId);
    if (!user.pendingTwoFactorSecret) {
      return reply.code(400).send({ error: 'no 2FA setup in progress — call setup first' });
    }
    if (!(await checkCode(user.pendingTwoFactorSecret, code))) {
      return reply.code(401).send({ error: 'invalid code' });
    }
    await updateUser(req.userId, {
      twoFactorEnabled: true,
      twoFactorSecret: user.pendingTwoFactorSecret,
      pendingTwoFactorSecret: null,
    });
    return { ok: true };
  });

  app.post('/api/auth/2fa/disable', { preHandler: requireAuth }, async (req, reply) => {
    const { password } = req.body ?? {};
    const user = await findUserById(req.userId);
    if (!(await verifyPassword(password ?? '', user.passwordHash))) {
      return reply.code(401).send({ error: 'incorrect password' });
    }
    await updateUser(req.userId, { twoFactorEnabled: false, twoFactorSecret: null, pendingTwoFactorSecret: null });
    return { ok: true };
  });

  // Each member's own AI assistant provider — an Anthropic key they pay for
  // themselves, or a pointer at an Ollama server. Never shared/billed to
  // one account; see server/src/routes/assistant.js for how this is used.
  app.get('/api/auth/assistant-settings', { preHandler: requireAuth }, async (req) => {
    const user = await findUserById(req.userId);
    return maskedAssistantSettings(user);
  });

  app.post('/api/auth/assistant-settings', { preHandler: requireAuth }, async (req, reply) => {
    const { provider, anthropicApiKey, anthropicModel, ollamaBaseUrl, ollamaModel } = req.body ?? {};
    const user = await findUserById(req.userId);
    const current = user.assistant || { provider: null };
    const next = { ...current };

    if (provider !== undefined) {
      if (provider !== null && provider !== 'anthropic' && provider !== 'ollama') {
        return reply.code(400).send({ error: 'provider must be "anthropic", "ollama", or null' });
      }
      next.provider = provider;
    }
    if (anthropicApiKey !== undefined) {
      if (anthropicApiKey !== '' && anthropicApiKey !== null && !/^sk-ant-/.test(anthropicApiKey)) {
        return reply.code(400).send({ error: 'that does not look like an Anthropic API key (they start with sk-ant-)' });
      }
      next.anthropicApiKey = anthropicApiKey || undefined;
    }
    if (anthropicModel !== undefined) {
      if (anthropicModel && !/^[a-z0-9.-]+$/.test(anthropicModel)) {
        return reply.code(400).send({ error: 'invalid model id' });
      }
      next.anthropicModel = anthropicModel || undefined;
    }
    if (ollamaBaseUrl !== undefined) {
      if (ollamaBaseUrl) {
        try {
          new URL(ollamaBaseUrl);
        } catch {
          return reply.code(400).send({ error: 'that does not look like a valid URL' });
        }
      }
      next.ollamaBaseUrl = ollamaBaseUrl || undefined;
    }
    if (ollamaModel !== undefined) {
      next.ollamaModel = ollamaModel || undefined;
    }

    await updateUser(req.userId, { assistant: next });
    return maskedAssistantSettings(await findUserById(req.userId));
  });
}
