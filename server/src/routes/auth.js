import {
  createUser,
  findUserByEmail,
  findUserById,
  updateUser,
  verifyPassword,
  publicUser,
  signTempToken,
  verifyTempToken,
} from '../lib/auth.js';
import { createSecret, checkCode, enrollmentDetails } from '../lib/twoFactor.js';
import { requireAuth } from '../lib/authMiddleware.js';

export default async function authRoutes(app) {
  app.post('/api/auth/signup', async (req, reply) => {
    const { email, password } = req.body ?? {};
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return reply.code(400).send({ error: 'a valid email is required' });
    }
    if (!password || password.length < 8) {
      return reply.code(400).send({ error: 'password must be at least 8 characters' });
    }
    let user;
    try {
      user = await createUser(email, password);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
    req.session.set('userId', user.id);
    return reply.code(201).send(publicUser(user));
  });

  app.post('/api/auth/login', async (req, reply) => {
    const { email, password } = req.body ?? {};
    const user = await findUserByEmail(email ?? '');
    if (!user || !verifyPassword(password ?? '', user.passwordHash)) {
      return reply.code(401).send({ error: 'invalid email or password' });
    }
    if (user.twoFactorEnabled) {
      return { needsTwoFactor: true, tempToken: signTempToken(user.id) };
    }
    req.session.set('userId', user.id);
    return publicUser(user);
  });

  app.post('/api/auth/login/2fa', async (req, reply) => {
    const { tempToken, code } = req.body ?? {};
    const userId = verifyTempToken(tempToken ?? '');
    if (!userId) return reply.code(401).send({ error: 'login attempt expired, please try again' });
    const user = await findUserById(userId);
    if (!user?.twoFactorEnabled) return reply.code(400).send({ error: '2FA is not enabled for this account' });
    if (!(await checkCode(user.twoFactorSecret, code))) {
      return reply.code(401).send({ error: 'invalid code' });
    }
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
    if (!verifyPassword(password ?? '', user.passwordHash)) {
      return reply.code(401).send({ error: 'incorrect password' });
    }
    await updateUser(req.userId, { twoFactorEnabled: false, twoFactorSecret: null, pendingTwoFactorSecret: null });
    return { ok: true };
  });
}
