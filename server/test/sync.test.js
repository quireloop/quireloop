import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync.js';
import * as awarenessProtocol from 'y-protocols/awareness.js';
import * as encoding from 'lib0/encoding.js';
import * as decoding from 'lib0/decoding.js';

// Two real copies of Quireloop, a server and a laptop, joined through a small
// relay this test can cut to make the laptop lose its network.
const SRC = path.resolve(import.meta.dirname, '../src/start.js');

function relay(targetPort) {
  const sockets = new Set();
  const state = { online: true };
  const server = net.createServer((client) => {
    if (!state.online) return client.destroy();
    const upstream = net.connect(targetPort, '127.0.0.1');
    client.pipe(upstream).pipe(client);
    for (const s of [client, upstream]) {
      sockets.add(s);
      s.on('error', () => {});
      s.on('close', () => sockets.delete(s));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        cut() {
          state.online = false;
          for (const s of sockets) s.destroy();
        },
        restore() {
          state.online = true;
        },
        close: () => {
          server.close();
          server.unref();
        },
      });
    });
  });
}

async function freePort() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  return port;
}

async function startInstance() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quireloop-sync-'));
  const port = await freePort();
  const child = spawn(process.execPath, [SRC], {
    env: { ...process.env, QUIRELOOP_DATA_DIR: dataDir, PORT: String(port), QUIRELOOP_OPEN_SIGNUP: 'true' },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { child, dataDir, port, base, cookie: '' };
}

async function call(instance, method, route, body, raw = false) {
  const res = await fetch(instance.base + route, {
    method,
    headers: {
      cookie: instance.cookie,
      ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}),
      ...(raw ? { 'content-type': 'text/plain' } : {}),
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie?.startsWith('session=')) instance.cookie = setCookie.split(';')[0];
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

// A browser, as far as a Quireloop room can tell.
function openEditor(instance, projectId, file, name) {
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalStateField('user', { name });
  const ws = new WebSocket(`ws://127.0.0.1:${instance.port}/ws/${projectId}/${file}`, {
    headers: { cookie: instance.cookie },
  });
  const send = (build) => {
    const encoder = encoding.createEncoder();
    build(encoder);
    if (ws.readyState === 1) ws.send(encoding.toUint8Array(encoder));
  };
  doc.on('update', (update, origin) => {
    if (origin === ws) return;
    send((e) => {
      encoding.writeVarUint(e, 0);
      syncProtocol.writeUpdate(e, update);
    });
  });
  awareness.on('update', ({ added, updated }, origin) => {
    if (origin === ws) return;
    send((e) => {
      encoding.writeVarUint(e, 1);
      encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(awareness, added.concat(updated)));
    });
  });
  ws.on('message', (data) => {
    const decoder = decoding.createDecoder(new Uint8Array(data));
    const type = decoding.readVarUint(decoder);
    if (type === 0) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      syncProtocol.readSyncMessage(decoder, encoder, doc, ws);
      if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder));
    } else {
      awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), ws);
    }
  });
  ws.on('error', () => {});
  const ready = new Promise((resolve) => {
    ws.on('open', () => {
      send((e) => {
        encoding.writeVarUint(e, 0);
        syncProtocol.writeSyncStep1(e, doc);
      });
      send((e) => {
        encoding.writeVarUint(e, 1);
        encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]));
      });
      resolve();
    });
  });
  return {
    doc,
    awareness,
    ws,
    ready,
    text: () => doc.getText('content').toString(),
    close: () => {
      ws.terminate();
      doc.destroy();
    },
  };
}

async function until(check, label, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) assert.fail(`timed out waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const sync = (laptop) => call(laptop, 'POST', '/api/link/sync-now', {});
const readText = (instance, id, file) => call(instance, 'GET', `/api/projects/${id}/files/${file}`);

let server, laptop, net1, remoteId, localId;

async function mirrorOf(name) {
  const list = await call(laptop, 'GET', '/api/projects');
  return list.find((p) => p.name === name);
}

before(async () => {
  server = await startInstance();
  laptop = await startInstance();
  net1 = await relay(server.port);
  await call(server, 'POST', '/api/auth/signup', { email: 'a@lab.test', password: 'password123' });
  await call(laptop, 'POST', '/api/auth/signup', { email: 'a@laptop.test', password: 'password123' });
  remoteId = (await call(server, 'POST', '/api/projects', { name: 'Paper', templateId: 'blank' })).id;
});

after(async () => {
  for (const i of [server, laptop]) {
    i.child.kill('SIGKILL');
    await fs.rm(i.dataDir, { recursive: true, force: true });
  }
  net1.cut();
  net1.close();
});

test('a computer links only after approval on the server', async () => {
  const url = `http://127.0.0.1:${net1.port}`;
  const { userCode } = await call(laptop, 'POST', '/api/link/start', { url, deviceName: 'my laptop' });
  await sync(laptop).catch(() => {});
  assert.equal((await call(laptop, 'GET', '/api/link/status')).url, null);

  const stranger = { ...server, cookie: '' };
  await assert.rejects(call(stranger, 'POST', `/api/sync/pair/${userCode}/approve`, {}));
  assert.equal((await call(server, 'GET', `/api/sync/pair/${userCode}`)).deviceName, 'my laptop');
  await call(server, 'POST', `/api/sync/pair/${userCode}/approve`, {});

  await until(async () => (await call(laptop, 'GET', '/api/link/status')).url === url, 'link to finish');
  const stored = JSON.parse(await fs.readFile(path.join(laptop.dataDir, 'sync-connection.json'), 'utf8'));
  // Windows has no owner-only file mode; the data folder sits in the user's
  // own profile, which Windows already keeps private.
  if (process.platform !== 'win32') {
    const mode = (await fs.stat(path.join(laptop.dataDir, 'sync-connection.json'))).mode & 0o777;
    assert.equal(mode, 0o600);
  }
  assert.ok(stored.token);
  assert.ok(!JSON.stringify(await call(laptop, 'GET', '/api/link/status')).includes(stored.token));
});

test('a device token opens only what sync needs', async () => {
  const { token } = JSON.parse(await fs.readFile(path.join(laptop.dataDir, 'sync-connection.json'), 'utf8'));
  const auth = { authorization: `Bearer ${token}` };
  const ok = await fetch(`${server.base}/api/sync/projects`, { headers: auth });
  assert.equal(ok.status, 200);
  for (const route of ['/api/auth/me', '/api/projects', '/api/admin/users', `/api/projects/${remoteId}`]) {
    assert.equal((await fetch(server.base + route, { headers: auth })).status, 401, route);
  }
  const bad = await fetch(`${server.base}/api/sync/projects`, { headers: { authorization: 'Bearer nope' } });
  assert.equal(bad.status, 401);
});

test('server papers arrive on the laptop', async () => {
  await call(server, 'PUT', `/api/projects/${remoteId}/files/main.tex`, 'hello from server\n', true);
  await fs.mkdir(path.join(server.dataDir, 'projects'), { recursive: true });
  await sync(laptop);
  const mirror = await mirrorOf('Paper');
  assert.ok(mirror?.sync, 'mirror exists');
  localId = mirror.id;
  assert.equal(await readText(laptop, localId, 'main.tex'), 'hello from server\n');
});

test('edits made on both sides while offline all survive, once each', async () => {
  const onLaptop = openEditor(laptop, localId, 'main.tex', 'me');
  await until(() => onLaptop.text().includes('hello'), 'laptop editor loads');
  const onServer = openEditor(server, remoteId, 'main.tex', 'co-author');
  await until(() => onServer.text().includes('hello'), 'server editor loads');

  net1.cut();
  await sync(laptop);
  assert.equal((await call(laptop, 'GET', '/api/link/status')).state, 'offline');

  onLaptop.doc.getText('content').insert(0, 'LAPTOP ');
  onServer.doc.getText('content').insert(onServer.text().length, 'SERVER\n');
  await until(async () => (await readText(laptop, localId, 'main.tex')).includes('LAPTOP'), 'still saves offline');
  assert.ok(!(await readText(laptop, localId, 'main.tex')).includes('SERVER'));

  net1.restore();
  await sync(laptop);
  const expected = 'LAPTOP hello from server\nSERVER\n';
  await until(() => onLaptop.text() === expected && onServer.text() === expected, 'both editors converge');
  await until(async () => (await readText(server, remoteId, 'main.tex')) === expected, 'server file');
  assert.equal((await call(laptop, 'GET', '/api/link/status')).state, 'online');
  onLaptop.close();
  onServer.close();
  await new Promise((r) => setTimeout(r, 300));
});

test('typing and cursors travel live between laptop and server', async () => {
  const onLaptop = openEditor(laptop, localId, 'main.tex', 'me');
  const onServer = openEditor(server, remoteId, 'main.tex', 'co-author');
  await until(() => onLaptop.text().length > 0 && onServer.text().length > 0, 'both load');

  const names = (e) => [...e.awareness.getStates().values()].map((s) => s.user?.name);
  await until(() => names(onServer).includes('me') && names(onLaptop).includes('co-author'), 'each sees the other');

  onLaptop.doc.getText('content').insert(0, 'L1 ');
  await until(() => onServer.text().startsWith('L1 '), 'laptop keystroke reaches server', 2000);
  onServer.doc.getText('content').insert(0, 'S1 ');
  await until(() => onLaptop.text().startsWith('S1 '), 'server keystroke reaches laptop', 2000);

  net1.cut();
  await until(() => !names(onLaptop).includes('co-author'), 'other cursor clears when offline', 5000);
  net1.restore();
  onLaptop.close();
  onServer.close();
  await new Promise((r) => setTimeout(r, 300));
});

test('new, changed and deleted files follow', async () => {
  await call(server, 'PUT', `/api/projects/${remoteId}/files/from-server.tex`, 'a\n', true);
  await call(laptop, 'PUT', `/api/projects/${localId}/files/sections/from-laptop.tex`, 'b\n', true);
  await fs.writeFile(path.join(laptop.dataDir, 'projects', await ownerDir(laptop), localId, 'figure.png'), Buffer.from([0, 159, 146, 150]));
  await sync(laptop);
  await until(async () => (await readText(server, remoteId, 'sections/from-laptop.tex')) === 'b\n', 'laptop file on server');
  assert.equal(await readText(laptop, localId, 'from-server.tex'), 'a\n');
  const serverFigure = path.join(server.dataDir, 'projects', await ownerDir(server), remoteId, 'figure.png');
  assert.deepEqual([...(await fs.readFile(serverFigure))], [0, 159, 146, 150]);

  await call(laptop, 'DELETE', `/api/projects/${localId}/files/from-server.tex`);
  await sync(laptop);
  await assert.rejects(readText(server, remoteId, 'from-server.tex'));
});

async function ownerDir(instance) {
  const [dir] = await fs.readdir(path.join(instance.dataDir, 'projects'));
  return dir;
}

test('a figure changed on both sides keeps both versions', async () => {
  const serverDir = path.join(server.dataDir, 'projects', await ownerDir(server), remoteId);
  const laptopDir = path.join(laptop.dataDir, 'projects', await ownerDir(laptop), localId);
  await fs.writeFile(path.join(serverDir, 'figure.png'), Buffer.from([1, 1, 200]));
  await fs.writeFile(path.join(laptopDir, 'figure.png'), Buffer.from([2, 2, 200]));
  await sync(laptop);
  assert.deepEqual([...(await fs.readFile(path.join(laptopDir, 'figure.png')))], [1, 1, 200]);
  const copy = (await fs.readdir(laptopDir)).find((f) => f.startsWith('figure.laptop-'));
  assert.ok(copy, 'local version kept');
  assert.deepEqual([...(await fs.readFile(path.join(laptopDir, copy)))], [2, 2, 200]);
  const { notices } = await call(laptop, 'GET', '/api/link/status');
  assert.ok(notices.some((n) => n.message.includes('figure.png')));
});

test('a restore on the server does not double the text', async () => {
  const before = await call(server, 'POST', `/api/projects/${remoteId}/versions`, { label: 'x' });
  await sync(laptop);
  await call(server, 'POST', `/api/projects/${remoteId}/versions/${before.id}/restore`, {});
  await call(laptop, 'PUT', `/api/projects/${localId}/files/notes.txt`, 'unrelated\n', true);
  await sync(laptop);
  const onServer = await readText(server, remoteId, 'main.tex');
  assert.equal(await readText(laptop, localId, 'main.tex'), onServer);
  assert.equal(onServer.split('hello from server').length, 2);
});

test('a damaged copy cannot wipe the server', async () => {
  const laptopDir = path.join(laptop.dataDir, 'projects', await ownerDir(laptop), localId);
  for (const f of ['main.tex', 'figure.png', 'notes.txt']) await fs.rm(path.join(laptopDir, f), { force: true });
  await fs.rm(path.join(laptopDir, 'sections'), { recursive: true, force: true });
  await sync(laptop);
  assert.ok((await readText(server, remoteId, 'main.tex')).includes('hello'));
  assert.ok((await readText(laptop, localId, 'main.tex')).includes('hello'));
});

test('paths from the other side cannot reach private files', async () => {
  const { token } = JSON.parse(await fs.readFile(path.join(laptop.dataDir, 'sync-connection.json'), 'utf8'));
  for (const bad of ['manifest.json', '../x', '.git/config', 'build/main.pdf', 'versions/a', '.quireloop-ydoc/a']) {
    const res = await fetch(`${server.base}/api/sync/projects/${remoteId}/raw?path=${encodeURIComponent(bad)}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
      body: 'x',
    });
    assert.equal(res.status, 400, bad);
  }
});

test('a paper written on the laptop can go to the server', async () => {
  const local = await call(laptop, 'POST', '/api/projects', { name: 'Written offline', templateId: 'blank' });
  await call(laptop, 'PUT', `/api/projects/${local.id}/files/main.tex`, 'my new paper\n', true);
  await call(laptop, 'POST', `/api/link/publish/${local.id}`, {});
  const onServer = (await call(server, 'GET', '/api/projects')).find((p) => p.name === 'Written offline');
  assert.equal(await readText(server, onServer.id, 'main.tex'), 'my new paper\n');
});

test('removing the computer on the server stops it', async () => {
  const [device] = await call(server, 'GET', '/api/sync/devices');
  await call(server, 'DELETE', `/api/sync/devices/${device.id}`);
  await sync(laptop);
  assert.equal((await call(laptop, 'GET', '/api/link/status')).state, 'reconnect-needed');
  assert.ok((await readText(laptop, localId, 'main.tex')).includes('hello'), 'local copy stays');
});
