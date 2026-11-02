import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { normalizeServerUrl, probeServer, request } from '../src/lib/syncTransport.js';
import { isSyncablePath } from '../src/lib/syncFiles.js';

function makeCert(dir, name) {
  const key = path.join(dir, `${name}.key`);
  const crt = path.join(dir, `${name}.crt`);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', `/CN=${name}`, '-keyout', key, '-out', crt], { stdio: 'ignore' });
  return Promise.all([fs.readFile(key), fs.readFile(crt)]);
}

test('plain http is refused except on this computer', () => {
  assert.throws(() => normalizeServerUrl('http://labserver.example/quireloop'));
  assert.equal(normalizeServerUrl('https://labserver.example/quireloop/'), 'https://labserver.example/quireloop');
  assert.equal(normalizeServerUrl('http://localhost:4173'), 'http://localhost:4173');
});

test('a self-signed server is reachable only with the certificate that was accepted', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'quireloop-tls-'));
  const [key, cert] = await makeCert(dir, 'labserver');
  const [otherKey, otherCert] = await makeCert(dir, 'impostor');
  const listen = (tls) =>
    new Promise((resolve) => {
      const server = https.createServer(tls, (_req, res) => res.end('ok'));
      server.listen(0, '127.0.0.1', () => resolve(server));
    });

  const real = await listen({ key, cert });
  const url = `https://127.0.0.1:${real.address().port}`;
  const probe = await probeServer(url);
  assert.equal(probe.trusted, false);
  const pin = { pem: probe.pem, fingerprint: probe.fingerprint };

  const ok = await request({ url, token: 't', pin }, 'GET', '/');
  assert.equal(ok.toString(), 'ok');
  await assert.rejects(request({ url, token: 't', pin: null }, 'GET', '/'));

  const fake = await listen({ key: otherKey, cert: otherCert });
  const fakeUrl = `https://127.0.0.1:${fake.address().port}`;
  await assert.rejects(request({ url: fakeUrl, token: 't', pin }, 'GET', '/'));

  real.close();
  fake.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test('private and hidden paths are never synced', () => {
  for (const bad of ['manifest.json', '.git/config', 'a/.env', 'build/x.pdf', '.quireloop-chat.json', 'versions/1', '', 'a\\b', 'a//b']) {
    assert.equal(isSyncablePath(bad), false, bad);
  }
  for (const good of ['main.tex', 'figures/a.png', 'sections/intro.tex']) {
    assert.equal(isSyncablePath(good), true, good);
  }
});
