import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { getTestApp, signup, createProject } from './helpers.js';

const { app, cleanup } = await getTestApp();
after(cleanup);

const owner = await signup(app, 'restorer@example.com');
const kept = await signup(app, 'kept@example.com');
const removed = await signup(app, 'removed@example.com');

function call(method, url, payload) {
  return app.inject({ method, url, headers: { cookie: owner.cookie }, payload });
}

async function write(id, text) {
  const res = await app.inject({
    method: 'PUT',
    url: `/api/projects/${id}/files/main.tex`,
    headers: { cookie: owner.cookie, 'content-type': 'text/plain' },
    payload: text,
  });
  assert.ok(res.statusCode < 300, res.body);
}

async function saveVersion(id, label) {
  return (await call('POST', `/api/projects/${id}/versions`, { label })).json().id;
}

async function restore(id, versionId) {
  const res = await call('POST', `/api/projects/${id}/versions/${versionId}/restore`);
  assert.equal(res.statusCode, 200, res.body);
  return (await call('GET', `/api/projects/${id}`)).json();
}

test('every restore moves the generation on, so open editors always reload', async () => {
  const project = await createProject(app, owner.cookie, 'Generations');
  await write(project.id, 'one');
  const one = await saveVersion(project.id, 'one');
  await write(project.id, 'two');
  const seen = [(await call('GET', `/api/projects/${project.id}`)).json().collabGeneration ?? 0];
  // Back and forth between old snapshots, whose manifests hold old numbers.
  for (const versionId of [one, (await call('GET', `/api/projects/${project.id}/versions`)).json()[0].id, one]) {
    seen.push((await restore(project.id, versionId)).collabGeneration);
  }
  for (let i = 1; i < seen.length; i += 1) assert.ok(seen[i] > seen[i - 1], `generations ${seen.join(', ')}`);
  const file = await call('GET', `/api/projects/${project.id}/files/main.tex`);
  assert.equal(file.body, 'one');
});

test('a restore brings the files back but not an old list of who it is shared with', async () => {
  const project = await createProject(app, owner.cookie, 'Sharing kept');
  await call('POST', `/api/projects/${project.id}/share`, { email: 'removed@example.com', role: 'editor' });
  await write(project.id, 'old text');
  const old = await saveVersion(project.id, 'old');

  await call('POST', `/api/projects/${project.id}/unshare`, { userId: removed.user.id });
  await call('POST', `/api/projects/${project.id}/share`, { email: 'kept@example.com', role: 'viewer' });
  await write(project.id, 'new text');

  const manifest = await restore(project.id, old);
  assert.deepEqual(manifest.collaborators.map((c) => c.email), ['kept@example.com']);
  assert.equal((await call('GET', `/api/projects/${project.id}/files/main.tex`)).body, 'old text');

  const blocked = await app.inject({ method: 'GET', url: `/api/projects/${project.id}`, headers: { cookie: removed.cookie } });
  assert.equal(blocked.statusCode, 403, 'someone removed before the restore stays removed');
  const allowed = await app.inject({ method: 'GET', url: `/api/projects/${project.id}`, headers: { cookie: kept.cookie } });
  assert.equal(allowed.statusCode, 200);
});

test('a file added after the snapshot is gone after restoring it, and listed accordingly', async () => {
  const project = await createProject(app, owner.cookie, 'File list');
  const before = await saveVersion(project.id, 'before');
  await app.inject({
    method: 'PUT',
    url: `/api/projects/${project.id}/files/extra.tex`,
    headers: { cookie: owner.cookie, 'content-type': 'text/plain' },
    payload: 'extra',
  });
  const manifest = await restore(project.id, before);
  assert.ok(!manifest.files.some((f) => f.path === 'extra.tex'), JSON.stringify(manifest.files));
});
