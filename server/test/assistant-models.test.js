import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// A stand-in Ollama and a stand-in grammar checker: tests never reach out.
let fake;
let fakeUrl;
let lastChat = null;
let lastCheck = null;
process.env.QUIRELOOP_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'ql-assist-'));
process.env.QUIRELOOP_OPEN_SIGNUP = 'true';

let app;
let cookie;
let projectId;

function call(method, url, body, headers = {}) {
  return app.inject({ method, url, payload: body, headers: { cookie, ...headers } });
}

before(async () => {
  fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      if (req.url === '/api/tags') {
        res.end(JSON.stringify({ models: [{ name: 'b:1' }, { name: 'a:2' }] }));
      } else if (req.url === '/api/chat') {
        lastChat = JSON.parse(raw);
        res.end(`${JSON.stringify({ message: { content: 'hi' }, done: true })}\n`);
      } else if (req.url === '/v2/check') {
        lastCheck = new URLSearchParams(raw);
        res.end(JSON.stringify({
          matches: [{ offset: 3, length: 3, message: 'Use "have".', rule: { issueType: 'grammar' }, replacements: [{ value: 'have' }] }],
        }));
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  fakeUrl = `http://127.0.0.1:${fake.address().port}`;
  process.env.QUIRELOOP_LANGUAGETOOL_URL = fakeUrl;
  const { buildApp } = await import('../src/index.js');
  app = await buildApp();
  await app.ready();
  const signup = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: { email: 'a@example.org', password: 'correct horse battery' },
  });
  assert.equal(signup.statusCode, 201, signup.body);
  cookie = signup.headers['set-cookie'].split(';')[0];
  const project = await call('POST', '/api/projects', { name: 'Paper' });
  projectId = JSON.parse(project.body).id;
});

after(async () => {
  await app.close();
  fake.close();
  fake.closeAllConnections?.();
});

test('with nothing set up, the list is empty rather than an error', async () => {
  const res = await call('GET', '/api/assistant/models');
  assert.deepEqual(JSON.parse(res.body), { provider: null, model: null, models: [] });
});

test('finds the models on an Ollama server before anything is saved', async () => {
  const res = await call('POST', '/api/assistant/ollama-models', { baseUrl: fakeUrl });
  assert.deepEqual(JSON.parse(res.body).models, ['a:2', 'b:1']);
});

test('a non-web address is refused', async () => {
  const res = await call('POST', '/api/assistant/ollama-models', { baseUrl: 'file:///etc/passwd' });
  assert.equal(res.statusCode, 400);
});

test('the chosen model is the one that answers', async () => {
  await call('POST', '/api/auth/assistant-settings', { provider: 'ollama', ollamaBaseUrl: fakeUrl });
  const list = JSON.parse((await call('GET', '/api/assistant/models')).body);
  assert.equal(list.provider, 'ollama');
  assert.equal(list.model, 'a:2');
  const res = await call('POST', `/api/projects/${projectId}/assistant`, {
    messages: [{ role: 'user', content: 'hello' }],
    model: 'b:1',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(lastChat.model, 'b:1');
  assert.match(res.body, /event: text/);
});

test('a malformed model name is refused', async () => {
  const res = await call('POST', `/api/projects/${projectId}/assistant`, {
    messages: [{ role: 'user', content: 'hello' }],
    model: 'a b/../c;',
  });
  assert.equal(res.statusCode, 400);
});

test('other providers keep their keys hidden', async () => {
  await call('POST', '/api/auth/assistant-settings', { provider: 'openai', openaiApiKey: 'sk-abcdefghijklmnop' });
  const res = await call('GET', '/api/auth/assistant-settings');
  assert.ok(!res.body.includes('sk-abcdefghijklmnop'));
  assert.equal(JSON.parse(res.body).openaiKeySet, true);
});

test('a bad key is refused', async () => {
  const res = await call('POST', '/api/auth/assistant-settings', { openaiApiKey: 'nope' });
  assert.equal(res.statusCode, 400);
});

test('grammar answers are positions in the original LaTeX', async () => {
  const text = '\\section{We has}';
  const res = await call('POST', `/api/projects/${projectId}/grammar`, { text });
  assert.equal(res.statusCode, 200, res.body);
  const data = JSON.parse(lastCheck.get('data'));
  assert.equal(data.annotation.map((p) => p.text ?? p.markup).join(''), text);
  assert.equal(JSON.parse(res.body).matches[0].replacements[0], 'have');
});

test('someone without access to the paper cannot use its grammar route', async () => {
  const res = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/grammar`, payload: { text: 'x' } });
  assert.equal(res.statusCode, 401);
});

test('a session lasts past the old 24-hour limit and renews with use', async () => {
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 20 * 24 * 60 * 60 * 1000;
    const res = await call('GET', '/api/auth/me');
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['set-cookie'], 'a renewed cookie comes back');
    const renewed = res.headers['set-cookie'].split(';')[0];
    Date.now = () => realNow() + 45 * 24 * 60 * 60 * 1000;
    const later = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: renewed } });
    assert.equal(later.statusCode, 200);
    const unused = await call('GET', '/api/auth/me');
    assert.equal(unused.statusCode, 401);
  } finally {
    Date.now = realNow;
  }
});

test('download everything gives a zip of the papers', async () => {
  const res = await call('GET', '/api/export/all');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/zip');
  assert.equal(res.rawPayload.subarray(0, 2).toString(), 'PK');
});

test('the backup folder gets plain files, and a change keeps the older version', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'ql-copy-'));
  const set = await call('POST', '/api/link/backup-folder', { path: folder });
  assert.equal(set.statusCode, 200, set.body);
  assert.ok(JSON.parse(set.body).lastCopyAt);
  const names = await fs.readdir(path.join(folder, 'Paper'));
  assert.ok(names.includes('main.tex'), names.join());
  assert.ok(!names.includes('manifest.json'));

  await call('PUT', `/api/projects/${projectId}/files/main.tex`, 'changed', { 'content-type': 'text/plain' });
  const { getSettings } = await import('../src/lib/settings.js');
  const { DATA_DIR } = await import('../src/config.js');
  const owner = (await fs.readdir(path.join(DATA_DIR, 'projects')))[0];
  await fs.writeFile(path.join(DATA_DIR, 'projects', owner, projectId, 'main.tex'), 'edited');
  await fs.rm(path.join(DATA_DIR, 'projects', owner, projectId, 'refs.bib'), { force: true });
  await call('POST', '/api/link/backup-folder/run');
  assert.equal(await fs.readFile(path.join(folder, 'Paper/main.tex'), 'utf8'), 'edited');
  const older = await fs.readdir(path.join(folder, '_older-versions'));
  assert.equal(older.length, 1);
  assert.ok((await fs.readFile(path.join(folder, '_older-versions', older[0], 'Paper/main.tex'), 'utf8')).length > 0);
  assert.ok((await getSettings()).backupFolder);
});

test('the backup folder may not be inside the data folder', async () => {
  const { DATA_DIR } = await import('../src/config.js');
  const res = await call('POST', '/api/link/backup-folder', { path: path.join(DATA_DIR, 'x') });
  assert.equal(res.statusCode, 400);
});
