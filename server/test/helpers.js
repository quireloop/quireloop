import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// config.js resolves QUIRELOOP_DATA_DIR into module-level constants at import
// time, and an ES module is only ever evaluated once per process. So the data
// directory is fixed for the whole process the moment anything imports the app
// — calling this twice in one file cannot produce two isolated data dirs, and
// quietly gave every test in a file the *first* one.
//
// The unit of isolation is therefore the test *file*: node:test runs each file
// in its own process, so one app per file is genuinely clean. This memoizes to
// enforce that, and tests that need a pristine users.json (anything asserting
// on admin role or signup counts) belong in their own file.
let instance;

export async function getTestApp() {
  if (instance) return instance;

  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quireloop-test-'));
  process.env.QUIRELOOP_DATA_DIR = dataDir;
  process.env.QUIRELOOP_OPEN_SIGNUP = 'true';

  const { buildApp } = await import('../src/index.js');
  const app = await buildApp({ logger: false });
  await app.ready();

  instance = {
    app,
    dataDir,
    async cleanup() {
      await app.close();
      await fs.rm(dataDir, { recursive: true, force: true });
    },
  };
  return instance;
}

// Signs up a user and returns the session cookie to pass as `cookie` on
// subsequent injects.
export async function signup(app, email, password = 'password123') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: { email, password },
  });
  if (res.statusCode !== 200 && res.statusCode !== 201) {
    throw new Error(`signup failed (${res.statusCode}): ${res.body}`);
  }
  return { cookie: sessionCookie(res), user: res.json() };
}

export function sessionCookie(res) {
  const raw = res.headers['set-cookie'];
  const all = Array.isArray(raw) ? raw : [raw];
  const session = all.find((c) => c?.startsWith('session='));
  if (!session) throw new Error('no session cookie in response');
  return session.split(';')[0];
}

export async function createProject(app, cookie, name = 'Test Project') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: { cookie },
    payload: { name, templateId: 'article' },
  });
  if (res.statusCode >= 300) throw new Error(`createProject failed: ${res.body}`);
  return res.json();
}
