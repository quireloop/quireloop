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

test('concurrent signups all persist', async () => {
  const { app, dataDir } = await getTestApp();

  const COUNT = 20;
  const results = await Promise.all(
    Array.from({ length: COUNT }, (_, i) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: { email: `user${i}@example.com`, password: 'password123' },
      })
    )
  );

  const ok = results.filter((r) => r.statusCode === 200 || r.statusCode === 201);
  assert.equal(ok.length, COUNT, 'every signup should succeed');

  const users = JSON.parse(await fs.readFile(path.join(dataDir, 'users.json'), 'utf8'));
  assert.equal(users.length, COUNT, `expected ${COUNT} users on disk, found ${users.length}`);

  // Exactly one admin — the first account, not "whichever write happened to win".
  assert.equal(users.filter((u) => u.role === 'admin').length, 1);
});
