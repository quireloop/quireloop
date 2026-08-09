import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// The per-user home is the case the feature exists for: a paper already at
// /home/arjun/Thesis/paper should be openable with no configuration. This
// file stands a fake /home in a temp dir and points the home base at it.
//
// Set before anything imports config.js, which freezes it — see helpers.js.
const homeBase = await fs.mkdtemp(path.join(os.tmpdir(), 'quireloop-home-'));
process.env.QUIRELOOP_USER_HOME_BASE = homeBase;
process.env.QUIRELOOP_LIBRARY_DIRS = '';

const { getTestApp, signup, sessionCookie } = await import('./helpers.js');

let app;
let arjunHome;

before(async () => {
  ({ app } = await getTestApp());

  // The unix account the convention should find: <base>/arjun for arjun@…
  arjunHome = path.join(homeBase, 'arjun');
  await fs.mkdir(path.join(arjunHome, 'Thesis', 'paper'), { recursive: true });
  await fs.writeFile(
    path.join(arjunHome, 'Thesis', 'paper', 'main.tex'),
    '\\documentclass{article}\n\\begin{document}\nThesis.\n\\end{document}\n'
  );

  // A second member's home, to prove one can't reach the other's.
  await fs.mkdir(path.join(homeBase, 'priya', 'private'), { recursive: true });
  await fs.writeFile(path.join(homeBase, 'priya', 'private', 'draft.tex'), 'confidential\n');
});

after(async () => {
  const { cleanup } = await getTestApp();
  await cleanup();
  await fs.rm(homeBase, { recursive: true, force: true });
});

// helpers.js's sessionCookie handles set-cookie arriving as a string or an
// array; indexing it directly yields a single character and a silent 401.
async function loginAs(email) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: 'password123' },
  });
  if (res.statusCode !== 200) throw new Error(`login failed for ${email}: ${res.body}`);
  return sessionCookie(res);
}

const roots = (cookie) => app.inject({ method: 'GET', url: '/api/library/roots', headers: { cookie } });
const browse = (cookie, p) =>
  app.inject({ method: 'GET', url: `/api/library/browse?path=${encodeURIComponent(p)}`, headers: { cookie } });

test("a member's home directory is a root with no configuration at all", async () => {
  const { cookie } = await signup(app, 'arjun@example.com');
  const body = (await roots(cookie)).json();

  assert.equal(body.enabled, true);
  assert.equal(body.roots.length, 1);
  assert.equal(body.roots[0].label, 'Your files');
  assert.equal(body.roots[0].path, await fs.realpath(arjunHome));
});

test('a project nested under the home directory opens in place', async () => {
  const arjunCookie = await loginAs('arjun@example.com');

  const target = path.join(arjunHome, 'Thesis', 'paper');
  const listing = (await browse(arjunCookie, target)).json();
  assert.deepEqual(listing.texFiles, ['main.tex']);

  const res = await app.inject({
    method: 'POST',
    url: '/api/projects/open-folder',
    headers: { cookie: arjunCookie },
    payload: { path: target, name: 'Thesis' },
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().linkedPath, await fs.realpath(target));
});

test("one member cannot browse another member's home", async () => {
  const { cookie } = await signup(app, 'priya@example.com');
  assert.equal((await browse(cookie, path.join(homeBase, 'arjun'))).statusCode, 404);

  const arjunCookie = await loginAs('arjun@example.com');
  const res = await browse(arjunCookie, path.join(homeBase, 'priya', 'private'));
  assert.equal(res.statusCode, 404);
  assert.ok(!res.body.includes('draft.tex'), "one member's files leaked to another");
});

test('a member with no matching home gets no roots, and no way in', async () => {
  const { cookie } = await signup(app, 'nobody@example.com');
  const body = (await roots(cookie)).json();
  assert.equal(body.enabled, false, 'the dashboard button should stay hidden');
  assert.equal(body.roots.length, 0);

  // And the home base itself is not browsable just because it's the base.
  assert.equal((await browse(cookie, homeBase)).statusCode, 404);
});

test('an admin can assign a server folder when the convention does not match', async () => {
  // arjun@example.com signed up first, so it is the admin.
  const adminCookie = await loginAs('arjun@example.com');

  const users = (await app.inject({ method: 'GET', url: '/api/admin/users', headers: { cookie: adminCookie } })).json();
  const nobody = users.find((u) => u.email === 'nobody@example.com');
  assert.equal(nobody.resolvedHomeDir, '', 'no folder should be detected for this account');

  const assigned = path.join(homeBase, 'assigned');
  await fs.mkdir(path.join(assigned, 'work'), { recursive: true });
  await fs.writeFile(path.join(assigned, 'work', 'main.tex'), '\\documentclass{article}\n');

  const set = await app.inject({
    method: 'POST',
    url: `/api/admin/users/${nobody.id}/home-dir`,
    headers: { cookie: adminCookie },
    payload: { homeDir: assigned },
  });
  assert.equal(set.statusCode, 200, set.body);

  const nobodyCookie = await loginAs('nobody@example.com');

  const body = (await roots(nobodyCookie)).json();
  assert.equal(body.enabled, true);
  assert.equal(body.roots[0].path, await fs.realpath(assigned));
  assert.equal((await browse(nobodyCookie, path.join(assigned, 'work'))).statusCode, 200);
  // Still fenced in — an assigned folder is a root, not a filesystem pass.
  assert.equal((await browse(nobodyCookie, arjunHome)).statusCode, 404);
});

test('a home folder that does not exist is refused rather than stored', async () => {
  const adminCookie = await loginAs('arjun@example.com');
  const users = (await app.inject({ method: 'GET', url: '/api/admin/users', headers: { cookie: adminCookie } })).json();
  const target = users.find((u) => u.email === 'priya@example.com');

  for (const bad of [path.join(homeBase, 'does-not-exist'), 'relative/path']) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${target.id}/home-dir`,
      headers: { cookie: adminCookie },
      payload: { homeDir: bad },
    });
    assert.equal(res.statusCode, 400, `"${bad}" should be refused`);
  }
});

test('only admins can assign server folders', async () => {
  const cookie = await loginAs('priya@example.com');
  const res = await app.inject({
    method: 'POST',
    url: `/api/admin/users/someone/home-dir`,
    headers: { cookie },
    payload: { homeDir: homeBase },
  });
  assert.equal(res.statusCode, 403);
});
