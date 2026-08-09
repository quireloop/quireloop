import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Logging in with the host's own UNIX accounts. The real PAM stack needs root,
// /etc/pam.d and actual system accounts, so these drive a fake helper that
// speaks the same stdin/stdout contract — see test/fake-pam-helper.mjs. What's
// under test is Quireloop's side: the login route, account provisioning, rate
// limiting, and that a UNIX home directory becomes the library root.
//
// Set before anything imports config.js, which freezes these — see helpers.js.
const homeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'quireloop-pam-'));
const arjunHome = path.join(homeRoot, 'arjun');
const priyaHome = path.join(homeRoot, 'priya');

const helper = fileURLToPath(new URL('./fake-pam-helper.mjs', import.meta.url));
const helperConfig = path.join(homeRoot, 'fake-pam.json');

const ACCOUNTS = {
  arjun: { password: 'unix-secret', code: '481920', uid: 1001, gid: 1001, home: arjunHome, fullName: 'Arjun P' },
  priya: { password: 'other-secret', code: '000111', uid: 1002, gid: 1002, home: priyaHome },
};
async function configureHelper({ broken = false } = {}) {
  await fs.writeFile(helperConfig, JSON.stringify({ accounts: ACCOUNTS, broken }));
}
await configureHelper();

process.env.QUIRELOOP_PAM_ENABLED = 'true';
process.env.QUIRELOOP_PAM_HELPER = `${process.execPath} ${helper} ${helperConfig}`;
process.env.QUIRELOOP_PAM_EMAIL_DOMAIN = 'lab.internal';
// Point the email-convention fallback at nothing, so anything that resolves
// here proves it came from the UNIX account rather than a lucky guess.
process.env.QUIRELOOP_USER_HOME_BASE = path.join(homeRoot, 'not-a-home-base');

const { getTestApp, signup, sessionCookie } = await import('./helpers.js');

let app;

before(async () => {
  ({ app } = await getTestApp());
  await fs.mkdir(path.join(arjunHome, 'Thesis', 'paper'), { recursive: true });
  await fs.writeFile(
    path.join(arjunHome, 'Thesis', 'paper', 'main.tex'),
    '\\documentclass{article}\n\\begin{document}\nFrom a real home directory.\n\\end{document}\n'
  );
  await fs.mkdir(priyaHome, { recursive: true });
});

after(async () => {
  const { cleanup } = await getTestApp();
  await cleanup();
  await fs.rm(homeRoot, { recursive: true, force: true });
});

// The rate limiter buckets by client IP, and every inject shares one by
// default — so a test that deliberately exhausts the limit would lock out
// every test after it. Anything doing that passes its own address.
const serverLogin = (payload, remoteAddress) =>
  app.inject({ method: 'POST', url: '/api/auth/login/server-account', payload, remoteAddress });

async function loginAsArjun() {
  const res = await serverLogin({ username: 'arjun', password: 'unix-secret', code: '481920' });
  assert.equal(res.statusCode, 200, res.body);
  return sessionCookie(res);
}

test('the login form is told that server accounts exist', async () => {
  const cfg = (await app.inject({ method: 'GET', url: '/api/auth/config' })).json();
  assert.equal(cfg.serverAccounts, true);
});

test('a UNIX account logs in and is provisioned once', async () => {
  const res = await serverLogin({ username: 'arjun', password: 'unix-secret', code: '481920' });
  assert.equal(res.statusCode, 200, res.body);
  const user = res.json();
  assert.equal(user.authProvider, 'pam');
  assert.equal(user.unixUser, 'arjun');
  assert.equal(user.email, 'arjun@lab.internal');
  assert.ok(!('passwordHash' in user), 'no credential material may reach the client');

  // The session works like any other.
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: sessionCookie(res) } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().id, user.id);

  // Logging in again reuses the record rather than making a second one.
  const again = await serverLogin({ username: 'arjun', password: 'unix-secret', code: '481920' });
  assert.equal(again.json().id, user.id, 'the account id must be stable across logins');
});

// The id is a directory name under data/projects and the key of the shared
// index, so a duplicate record would split one person's work across two
// identities. This is the lost-update class jsonStore.js exists to prevent.
test('concurrent first logins create exactly one account', async () => {
  const results = await Promise.all(
    Array.from({ length: 12 }, () =>
      serverLogin({ username: 'priya', password: 'other-secret', code: '000111' })
    )
  );
  for (const res of results) assert.equal(res.statusCode, 200, res.body);

  const ids = new Set(results.map((r) => r.json().id));
  assert.equal(ids.size, 1, `12 concurrent logins produced ${ids.size} distinct accounts`);
});

test("the UNIX home directory becomes the member's library root", async () => {
  const cookie = await loginAsArjun();
  const roots = (await app.inject({ method: 'GET', url: '/api/library/roots', headers: { cookie } })).json();

  assert.equal(roots.enabled, true);
  assert.equal(roots.roots.length, 1);
  assert.equal(roots.roots[0].path, await fs.realpath(arjunHome));
});

// The whole point of the redesign: no admin configuration, no guessing a
// directory from the email address.
test('a paper already in the home directory opens with no configuration', async () => {
  const cookie = await loginAsArjun();
  const target = path.join(arjunHome, 'Thesis', 'paper');

  const res = await app.inject({
    method: 'POST',
    url: '/api/projects/open-folder',
    headers: { cookie },
    payload: { path: target, name: 'Thesis' },
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().linkedPath, await fs.realpath(target));
});

test('one member still cannot reach another member\'s home', async () => {
  const cookie = await loginAsArjun();
  const res = await app.inject({
    method: 'GET',
    url: `/api/library/browse?path=${encodeURIComponent(priyaHome)}`,
    headers: { cookie },
  });
  assert.equal(res.statusCode, 404);
});

test('a wrong password or a wrong code is refused', async () => {
  const from = '10.10.0.1';
  assert.equal((await serverLogin({ username: 'arjun', password: 'wrong', code: '481920' }, from)).statusCode, 401);
  assert.equal((await serverLogin({ username: 'arjun', password: 'unix-secret', code: '000000' }, from)).statusCode, 401);
  // An account that doesn't exist on the host is refused identically — the
  // helper never distinguishes the two, so this cannot enumerate accounts.
  const ghost = await serverLogin({ username: 'ghost', password: 'x', code: 'y' }, from);
  assert.equal(ghost.statusCode, 401);
  assert.equal(ghost.json().error, 'invalid username, password, or code');
});

// Its own client IP *and* its own username: the limiter buckets by both, and
// exhausting either one would lock that identity out of every later test.
test('repeated failed attempts are rate-limited', async () => {
  const from = '10.10.0.2';
  let sawRateLimit = false;
  for (let i = 0; i < 14; i++) {
    const res = await serverLogin({ username: 'ratelimit-probe', password: 'wrong', code: 'wrong' }, from);
    assert.notEqual(res.statusCode, 200, 'a wrong password must never authenticate');
    if (res.statusCode === 429) {
      sawRateLimit = true;
      break;
    }
  }
  assert.ok(sawRateLimit, 'repeated failures should trigger the rate limiter');
});

test('a disabled account cannot log in even with correct credentials', async () => {
  // arjun signed up first overall, so it is the admin.
  const adminCookie = await loginAsArjun();
  const users = (await app.inject({ method: 'GET', url: '/api/admin/users', headers: { cookie: adminCookie } })).json();
  const priya = users.find((u) => u.unixUser === 'priya');
  assert.ok(priya, 'priya should appear in the admin list');

  await app.inject({
    method: 'POST',
    url: `/api/admin/users/${priya.id}/disable`,
    headers: { cookie: adminCookie },
  });

  const res = await serverLogin({ username: 'priya', password: 'other-secret', code: '000111' });
  assert.equal(res.statusCode, 403);

  await app.inject({
    method: 'POST',
    url: `/api/admin/users/${priya.id}/enable`,
    headers: { cookie: adminCookie },
  });
});

test('a server account cannot be logged into, or have its credentials changed, as a local one', async () => {
  const cookie = await loginAsArjun();

  // The synthesized address is not a password login.
  const viaEmail = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'arjun@lab.internal', password: 'unix-secret' },
  });
  assert.equal(viaEmail.statusCode, 401);

  for (const url of ['/api/auth/2fa/setup', '/api/auth/change-password']) {
    const res = await app.inject({ method: 'POST', url, headers: { cookie }, payload: {} });
    assert.equal(res.statusCode, 400, `${url} should refuse a server account`);
    assert.match(res.json().error, /managed on the server/);
  }
});

test("an admin cannot override a server account's folder", async () => {
  const adminCookie = await loginAsArjun();
  const users = (await app.inject({ method: 'GET', url: '/api/admin/users', headers: { cookie: adminCookie } })).json();
  const arjun = users.find((u) => u.unixUser === 'arjun');

  const res = await app.inject({
    method: 'POST',
    url: `/api/admin/users/${arjun.id}/home-dir`,
    headers: { cookie: adminCookie },
    payload: { homeDir: homeRoot },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /change it on the server/);
});

test('email/password accounts are unaffected', async () => {
  const { cookie, user } = await signup(app, 'outside-collaborator@example.com');
  assert.equal(user.authProvider, 'local');

  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().email, 'outside-collaborator@example.com');
});

// A broken sudoers rule produces no usable stdout. Reporting that as a bad
// password would send an operator to reset credentials that were fine.
test('a helper that cannot run is reported as a server fault, not a bad password', async () => {
  await configureHelper({ broken: true });
  try {
    const res = await serverLogin({ username: 'arjun', password: 'unix-secret', code: '481920' });
    assert.equal(res.statusCode, 503);
    assert.match(res.json().error, /could not check your credentials/);
  } finally {
    await configureHelper();
  }
});
