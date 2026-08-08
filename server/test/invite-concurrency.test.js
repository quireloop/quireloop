import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getTestApp, signup, createProject } from './helpers.js';

// One app (and one data dir) per file — see the note in helpers.js.
after(async () => {
  const { cleanup } = await getTestApp();
  await cleanup();
});

// These are regression tests for measured data loss, not hypotheticals. Before
// lib/jsonStore.js existed, every one of them failed on this codebase:
//   - 20 concurrent signups persisted 1 user
//   - 15 concurrent file saves left 14 files on disk but only 9 in the manifest
// Both were silent: no error, no log line, just missing data.

test('a single-use invite cannot be redeemed twice concurrently', async () => {
  const { app } = await getTestApp();

  const { cookie: adminCookie } = await signup(app, 'admin@example.com');
  const inviteRes = await app.inject({
    method: 'POST',
    url: '/api/admin/invites',
    headers: { cookie: adminCookie },
  });
  assert.ok(inviteRes.statusCode < 300, `invite creation failed: ${inviteRes.body}`);
  const { code } = inviteRes.json();

  // The helper enables open signup so other suites can create users freely;
  // the invite path only engages when it's off.
  process.env.QUIRELOOP_OPEN_SIGNUP = 'false';

  // Two people racing to redeem the same single-use code. Exactly one may win.
  const [a, b] = await Promise.all([
    app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'first@example.com', password: 'password123', inviteCode: code },
    }),
    app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'second@example.com', password: 'password123', inviteCode: code },
    }),
  ]);

  const invites = await app
    .inject({ method: 'GET', url: '/api/admin/invites', headers: { cookie: adminCookie } })
    .then((r) => r.json());
  const used = invites.filter((i) => i.usedBy);
  assert.equal(used.length, 1, 'the code should be marked used exactly once');
  assert.equal(
    [a, b].filter((r) => r.statusCode < 300).length,
    1,
    'exactly one of the two racing signups should succeed'
  );
});
