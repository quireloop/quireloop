import { requireAdmin } from '../lib/authMiddleware.js';
import { readManifest } from '../lib/manifest.js';
import * as projectIndex from '../lib/projectIndex.js';
import * as syncClient from '../lib/syncClient.js';
import * as folderCopy from '../lib/folderCopy.js';
import { normalizeServerUrl, probeServer, request } from '../lib/syncTransport.js';

// The local side of linking this computer to a server, used by this computer's
// own interface. Admin-only because this makes the server reach out to an
// address it is given.
const POLL_INTERVAL_MS = 2000;

let pending = null; // { url, pin, deviceName, deviceCode, userCode, verifyUrl, expiresAt, error }

async function collect(attempt, localUserId) {
  const connection = { url: attempt.url, token: '', pin: attempt.pin };
  while (pending === attempt && Date.now() < attempt.expiresAt) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    try {
      const result = await request(connection, 'POST', '/api/sync/pair/poll', {
        json: { deviceCode: attempt.deviceCode },
      });
      if (result.token) {
        await syncClient.connect({
          url: attempt.url,
          pin: attempt.pin,
          deviceName: attempt.deviceName,
          token: result.token,
          localUserId,
        });
        if (pending === attempt) pending = null;
        return;
      }
    } catch (err) {
      if (!err.offline) {
        attempt.error = err.message;
        return;
      }
    }
  }
  if (pending === attempt) attempt.error = 'The code expired. Start again.';
}

export default async function linkRoutes(app) {
  app.get('/api/link/status', { preHandler: requireAdmin }, async () => ({
    ...syncClient.getStatus(),
    defaultDeviceName: syncClient.defaultDeviceName(),
    pending: pending && { userCode: pending.userCode, verifyUrl: pending.verifyUrl, error: pending.error },
  }));

  app.post('/api/link/probe', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const url = normalizeServerUrl(req.body?.url);
      const { pem: _pem, ...details } = await probeServer(url);
      return { url, ...details };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/link/start', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const url = normalizeServerUrl(req.body?.url);
      const probe = await probeServer(url);
      // What was accepted must be what is pinned, so the certificate is read
      // again here and compared with the one the person was shown.
      if (!probe.trusted && probe.fingerprint !== req.body?.fingerprint) {
        return reply.code(400).send({ error: 'the server certificate does not match the one you accepted' });
      }
      const pin = probe.trusted ? null : { pem: probe.pem, fingerprint: probe.fingerprint };
      const deviceName = String(req.body?.deviceName || syncClient.defaultDeviceName());
      const started = await request({ url, token: '', pin }, 'POST', '/api/sync/pair/start', { json: { deviceName } });
      pending = {
        url,
        pin,
        deviceName,
        deviceCode: started.deviceCode,
        userCode: started.userCode,
        verifyUrl: `${url}/?link=${started.userCode}`,
        expiresAt: Date.now() + started.expiresInSeconds * 1000,
      };
      collect(pending, req.userId);
      return { userCode: pending.userCode, verifyUrl: pending.verifyUrl };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/link/cancel', { preHandler: requireAdmin }, async () => {
    pending = null;
    return { ok: true };
  });

  app.post('/api/link/disconnect', { preHandler: requireAdmin }, async () => {
    await syncClient.disconnect();
    return { ok: true };
  });

  app.post('/api/link/sync-now', { preHandler: requireAdmin }, async () => {
    await syncClient.syncOnce();
    return syncClient.getStatus();
  });

  app.get('/api/link/backup-folder', { preHandler: requireAdmin }, async () => folderCopy.getStatus());

  app.post('/api/link/backup-folder', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return await folderCopy.setFolder(req.body?.path);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/link/backup-folder/run', { preHandler: requireAdmin }, async () => {
    await folderCopy.copyOnce();
    return folderCopy.getStatus();
  });

  app.post('/api/link/publish/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const ownerId = await projectIndex.getOwner(req.params.id);
    if (ownerId !== req.userId) return reply.code(404).send({ error: 'project not found' });
    const manifest = await readManifest(ownerId, req.params.id);
    if (manifest.sync) return reply.code(400).send({ error: 'this project is already on the server' });
    if (!syncClient.getStatus().url) return reply.code(400).send({ error: 'connect to a server first' });
    try {
      return await syncClient.publishProject(manifest);
    } catch (err) {
      return reply.code(502).send({ error: err.offline ? 'the server cannot be reached right now' : err.message });
    }
  });
}
