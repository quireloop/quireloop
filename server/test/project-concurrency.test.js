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

test('concurrent file saves all land in the manifest', async () => {
  const { app } = await getTestApp();

  const { cookie } = await signup(app, 'owner@example.com');
  const project = await createProject(app, cookie);

  const COUNT = 15;
  await Promise.all(
    Array.from({ length: COUNT }, (_, i) =>
      app.inject({
        method: 'PUT',
        url: `/api/projects/${project.id}/files/chapter${i}.tex`,
        headers: { cookie, 'content-type': 'text/plain' },
        payload: `\\section{Chapter ${i}}`,
      })
    )
  );

  const res = await app.inject({ method: 'GET', url: `/api/projects/${project.id}`, headers: { cookie } });
  const manifest = res.json();

  for (let i = 0; i < COUNT; i++) {
    assert.ok(
      manifest.files.some((f) => f.path === `chapter${i}.tex`),
      `chapter${i}.tex missing from manifest — a concurrent save clobbered it`
    );
  }
  // main.tex from the template, plus every chapter.
  assert.equal(manifest.files.length, COUNT + 1);
});

test('concurrent chat messages are all kept', async () => {
  const { app } = await getTestApp();

  const { cookie } = await signup(app, 'chatter@example.com');
  const project = await createProject(app, cookie);

  const COUNT = 12;
  await Promise.all(
    Array.from({ length: COUNT }, (_, i) =>
      app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chat`,
        headers: { cookie },
        payload: { text: `message ${i}` },
      })
    )
  );

  const messages = await app
    .inject({ method: 'GET', url: `/api/projects/${project.id}/chat`, headers: { cookie } })
    .then((r) => r.json());
  const texts = new Set((Array.isArray(messages) ? messages : messages.messages).map((m) => m.text));
  for (let i = 0; i < COUNT; i++) {
    assert.ok(texts.has(`message ${i}`), `chat message ${i} was lost to a concurrent write`);
  }
});

test('concurrent project creation keeps every project reachable', async () => {
  const { app } = await getTestApp();

  const { cookie } = await signup(app, 'busy@example.com');

  const COUNT = 10;
  const created = await Promise.all(
    Array.from({ length: COUNT }, (_, i) =>
      app
        .inject({
          method: 'POST',
          url: '/api/projects',
          headers: { cookie },
          payload: { name: `Project ${i}`, templateId: 'blank' },
        })
        .then((r) => r.json())
    )
  );

  // The project index maps id -> owner; a lost write there makes the project
  // permanently unreachable even though its files exist on disk.
  for (const project of created) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}`,
      headers: { cookie },
    });
    assert.equal(res.statusCode, 200, `project ${project.id} fell out of the index`);
  }
});
