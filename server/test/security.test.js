import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { getTestApp, signup, createProject } from './helpers.js';

// One app (and one data dir) per file — see the note in helpers.js.
after(async () => {
  const { cleanup } = await getTestApp();
  await cleanup();
});

test('unauthenticated requests are rejected', async () => {
  const { app } = await getTestApp();
  for (const url of ['/api/projects', '/api/auth/me', '/api/admin/users']) {
    const res = await app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 401, `${url} should require authentication`);
  }
});

// Traversal is blocked by two independent layers, and the tests assert the
// property rather than a specific status code, because which layer catches an
// attempt depends on its encoding:
//
//   - Literal "../" segments are collapsed by the router's path normalization
//     before routing, so the request never reaches the file handler at all and
//     falls through to the SPA catch-all (200 text/html — the app shell, not
//     any file).
//   - Percent-encoded "..%2f" survives normalization, reaches the handler, and
//     is rejected there by resolveProjectPath's containment check (404).
//
// What must hold either way: no file from outside the project is ever served.
test('project file paths cannot escape the project directory', async () => {
  const { app } = await getTestApp();
  const { cookie } = await signup(app, 'traversal@example.com');
  const project = await createProject(app, cookie);

  const attempts = [
    '../../../../etc/passwd',
    '..%2f..%2f..%2f..%2fetc%2fpasswd',
    '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    'subdir/../../../../../../etc/passwd',
    '../manifest.json',
    '..%2fmanifest.json',
  ];

  for (const attempt of attempts) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/files/${attempt}`,
      headers: { cookie },
    });

    assert.ok(!res.body.includes('root:'), `traversal via "${attempt}" leaked /etc/passwd`);
    // The file route is the only thing that replies as text/plain. Anything
    // else means the request never produced file content.
    assert.notEqual(
      res.headers['content-type']?.split(';')[0],
      'text/plain',
      `traversal via "${attempt}" was served as project file content`
    );
  }
});

test('writing to a path outside the project is refused', async () => {
  const { app } = await getTestApp();
  const { cookie } = await signup(app, 'traversal-write@example.com');
  const project = await createProject(app, cookie);

  const res = await app.inject({
    method: 'PUT',
    url: `/api/projects/${project.id}/files/..%2f..%2fescaped.tex`,
    headers: { cookie, 'content-type': 'text/plain' },
    payload: 'should never be written',
  });
  assert.ok(res.statusCode >= 400, 'a write escaping the project root must be refused');
});

test("a user cannot read or write someone else's project", async () => {
  const { app } = await getTestApp();
  const { cookie: ownerCookie } = await signup(app, 'owner2@example.com');
  const { cookie: strangerCookie } = await signup(app, 'stranger@example.com');
  const project = await createProject(app, ownerCookie, 'Private');

  const read = await app.inject({
    method: 'GET',
    url: `/api/projects/${project.id}`,
    headers: { cookie: strangerCookie },
  });
  assert.equal(read.statusCode, 403);

  const write = await app.inject({
    method: 'PUT',
    url: `/api/projects/${project.id}/files/main.tex`,
    headers: { cookie: strangerCookie, 'content-type': 'text/plain' },
    payload: 'pwned',
  });
  assert.equal(write.statusCode, 403);
});

test('a viewer can read but cannot write, clean, or delete', async () => {
  const { app } = await getTestApp();
  const { cookie: ownerCookie } = await signup(app, 'owner3@example.com');
  const { cookie: viewerCookie, user: viewer } = await signup(app, 'viewer@example.com');
  const project = await createProject(app, ownerCookie, 'Shared read-only');

  const share = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/share`,
    headers: { cookie: ownerCookie },
    payload: { email: viewer.email, role: 'viewer' },
  });
  assert.ok(share.statusCode < 300, `share failed: ${share.body}`);

  const read = await app.inject({
    method: 'GET',
    url: `/api/projects/${project.id}`,
    headers: { cookie: viewerCookie },
  });
  assert.equal(read.statusCode, 200, 'a viewer should still be able to read');

  const write = await app.inject({
    method: 'PUT',
    url: `/api/projects/${project.id}/files/main.tex`,
    headers: { cookie: viewerCookie, 'content-type': 'text/plain' },
    payload: 'edited by viewer',
  });
  assert.equal(write.statusCode, 403, 'a viewer must not be able to write files');

  // /clean deletes the build directory, so it's a write even though it only
  // touches generated output — it used to be reachable with read access.
  const clean = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/clean`,
    headers: { cookie: viewerCookie },
  });
  assert.equal(clean.statusCode, 403, 'a viewer must not be able to wipe the build directory');

  const destroy = await app.inject({
    method: 'DELETE',
    url: `/api/projects/${project.id}`,
    headers: { cookie: viewerCookie },
  });
  assert.equal(destroy.statusCode, 403, 'only the owner may delete a project');
});

test('a non-admin cannot reach the admin API', async () => {
  const { app } = await getTestApp();
  await signup(app, 'firstadmin@example.com'); // first account becomes admin
  const { cookie: memberCookie } = await signup(app, 'member@example.com');

  for (const [method, url] of [
    ['GET', '/api/admin/users'],
    ['GET', '/api/admin/invites'],
    ['POST', '/api/admin/invites'],
  ]) {
    const res = await app.inject({ method, url, headers: { cookie: memberCookie } });
    assert.equal(res.statusCode, 403, `${method} ${url} should require admin`);
  }
});

test('password hashes and 2FA secrets never appear in API responses', async () => {
  const { app } = await getTestApp();
  const { cookie } = await signup(app, 'secrets@example.com');

  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
  const body = me.body;
  for (const leak of ['passwordHash', 'twoFactorSecret', 'pendingTwoFactorSecret']) {
    assert.ok(!body.includes(leak), `/api/auth/me leaked ${leak}`);
  }
});

test('login rejects a wrong password and eventually rate-limits', async () => {
  const { app } = await getTestApp();
  await signup(app, 'ratelimit@example.com', 'correct-horse');

  let sawRateLimit = false;
  for (let i = 0; i < 12; i++) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ratelimit@example.com', password: 'wrong' },
    });
    assert.notEqual(res.statusCode, 200, 'a wrong password must never authenticate');
    if (res.statusCode === 429) {
      sawRateLimit = true;
      break;
    }
  }
  assert.ok(sawRateLimit, 'repeated failed logins should trigger the rate limiter');
});
