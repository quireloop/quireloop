import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { getTestApp, signup, createProject } from './helpers.js';

const { app, cleanup } = await getTestApp();
after(cleanup);

// The first account is the admin, which can disable the others below.
const owner = await signup(app, 'owner@example.com');
const editor = await signup(app, 'b@example.com');
const viewer = await signup(app, 'c@example.com');
const away = await signup(app, 'away@example.com');
const project = await createProject(app, owner.cookie, 'Picked');

function inject(cookie, method, url, payload) {
  return app.inject({ method, url, headers: { cookie }, payload });
}

test('an owner sees the other active accounts, but not themself or disabled ones', async () => {
  const disable = await inject(owner.cookie, 'POST', `/api/admin/users/${away.user.id}/disable`);
  assert.equal(disable.statusCode, 200, disable.body);

  const res = await inject(owner.cookie, 'GET', `/api/projects/${project.id}/shareable-users`);
  assert.equal(res.statusCode, 200, res.body);
  const names = res.json().map((u) => u.name);
  assert.deepEqual(names, ['b@example.com', 'c@example.com']);
  assert.deepEqual(Object.keys(res.json()[0]).sort(), ['email', 'id', 'name']);
});

test('only the owner may list accounts', async () => {
  const res = await inject(editor.cookie, 'GET', `/api/projects/${project.id}/shareable-users`);
  assert.equal(res.statusCode, 403);
});

test('several people are shared with at once, each with their own role', async () => {
  const res = await inject(owner.cookie, 'POST', `/api/projects/${project.id}/share`, {
    members: [
      { userId: editor.user.id, role: 'editor' },
      { userId: viewer.user.id, role: 'viewer' },
    ],
  });
  assert.equal(res.statusCode, 200, res.body);
  const roles = Object.fromEntries(res.json().collaborators.map((c) => [c.email, c.role]));
  assert.deepEqual(roles, { 'b@example.com': 'editor', 'c@example.com': 'viewer' });

  const opened = await inject(viewer.cookie, 'GET', `/api/projects/${project.id}`);
  assert.equal(opened.statusCode, 200);
  const write = await app.inject({
    method: 'PUT',
    url: `/api/projects/${project.id}/files/main.tex`,
    headers: { cookie: viewer.cookie, 'content-type': 'text/plain' },
    payload: 'edited',
  });
  assert.equal(write.statusCode, 403, 'a viewer picked from the list must not write');
});

test('picking someone already shared with leaves their role alone', async () => {
  const res = await inject(owner.cookie, 'POST', `/api/projects/${project.id}/share`, {
    members: [{ userId: viewer.user.id, role: 'editor' }],
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().collaborators.find((c) => c.userId === viewer.user.id).role, 'viewer');
});

test('unknown, disabled or own accounts are refused and nothing is shared', async () => {
  const other = await createProject(app, owner.cookie, 'Untouched');
  for (const members of [
    [{ userId: 'nosuchuser' }],
    [{ userId: away.user.id }],
    [{ userId: owner.user.id }],
    [{ userId: editor.user.id }, { userId: 'nosuchuser' }],
    [],
  ]) {
    const res = await inject(owner.cookie, 'POST', `/api/projects/${other.id}/share`, { members });
    assert.ok(res.statusCode >= 400, `${JSON.stringify(members)} gave ${res.statusCode}`);
  }
  const manifest = await inject(owner.cookie, 'GET', `/api/projects/${other.id}`);
  assert.deepEqual(manifest.json().collaborators ?? [], []);
});

test('sharing by email still works', async () => {
  const other = await createProject(app, owner.cookie, 'By email');
  const res = await inject(owner.cookie, 'POST', `/api/projects/${other.id}/share`, { email: 'b@example.com', role: 'viewer' });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().collaborators[0].role, 'viewer');
});
