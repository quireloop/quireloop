import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as Y from 'yjs';
import { getTestApp, signup, createProject } from './helpers.js';

const { app, cleanup } = await getTestApp();
const collab = await import('../src/lib/collab.js');
const { projectDir } = await import('../src/lib/storage.js');
const { cookie, user } = await signup(app, 'outside@example.com');
const projects = [];
// An open doc's cursor tracker runs a timer until the doc is closed.
after(async () => {
  for (const id of projects) collab.invalidateProject(user.id, id);
  await cleanup();
});


async function freshProject(name) {
  const project = await createProject(app, cookie, name);
  projects.push(project.id);
  return { id: project.id, file: path.join(projectDir(user.id, project.id), 'main.tex') };
}

function type(room, text) {
  const ytext = room.doc.getText('content');
  ytext.insert(ytext.length, text);
}

// Stands in for a browser tab: the poll only runs while someone is connected.
const tab = { readyState: 3, send() {}, close() {} };

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('an edit made outside while nobody has the file open survives reopening and typing', async () => {
  const { id, file } = await freshProject('Reopened');
  const room = await collab.getRoom(user.id, id, 'main.tex');
  type(room, '% typed in the editor\n');
  await collab.flushProject(user.id, id);

  await fs.writeFile(file, 'written by another program\n');

  const reopened = await collab.getRoom(user.id, id, 'main.tex');
  assert.equal(reopened.doc.getText('content').toString(), 'written by another program\n');
  type(reopened, 'then typed\n');
  await collab.flushProject(user.id, id);
  assert.equal(await fs.readFile(file, 'utf8'), 'written by another program\nthen typed\n');
});

test('an open file picks up an outside edit by itself and shows it', async () => {
  const { id, file } = await freshProject('Live');
  const room = await collab.getRoom(user.id, id, 'main.tex');
  collab.addConnection(room, tab, user.id, user.email);
  try {
    await fs.writeFile(file, 'changed while open\n');
    // Two checks, 1.5 s apart, see the same file before it is read.
    await wait(4000);
    assert.equal(room.doc.getText('content').toString(), 'changed while open\n');
  } finally {
    collab.removeConnection(room, tab);
  }
});

test('typing in the browser and an outside edit at the same time both survive', async () => {
  const { id, file } = await freshProject('Both');
  const room = await collab.getRoom(user.id, id, 'main.tex');
  room.doc.getText('content').delete(0, room.doc.getText('content').length);
  type(room, 'first line\nsecond line\n');
  await collab.flushProject(user.id, id);

  // The browser adds to the end, not yet saved, while another program
  // rewrites the first line on disk.
  type(room, 'typed in the browser\n');
  await fs.writeFile(file, 'FIRST LINE, EDITED OUTSIDE\nsecond line\n');
  await collab.flushProject(user.id, id);

  const merged = 'FIRST LINE, EDITED OUTSIDE\nsecond line\ntyped in the browser\n';
  assert.equal(room.doc.getText('content').toString(), merged);
  assert.equal(await fs.readFile(file, 'utf8'), merged);
});

test('a save with nothing new leaves the file untouched', async () => {
  const { id, file } = await freshProject('Untouched');
  const room = await collab.getRoom(user.id, id, 'main.tex');
  await collab.flushProject(user.id, id);
  const before = (await fs.stat(file)).mtimeMs;
  await wait(50);
  await collab.releaseRoom(room);
  assert.equal((await fs.stat(file)).mtimeMs, before);
});

test('a browser holding the old history still ends up with the outside edit', async () => {
  const { id, file } = await freshProject('Stale tab');
  const room = await collab.getRoom(user.id, id, 'main.tex');
  // A tab's own copy of the doc, as it stood before the outside edit.
  const browser = new Y.Doc();
  Y.applyUpdate(browser, Y.encodeStateAsUpdate(room.doc));

  await fs.writeFile(file, 'the assistant rewrote this\n');
  const current = await collab.getRoom(user.id, id, 'main.tex');
  // The tab reconnects and the two exchange what the other is missing.
  Y.applyUpdate(current.doc, Y.encodeStateAsUpdate(browser, Y.encodeStateVector(current.doc)));
  Y.applyUpdate(browser, Y.encodeStateAsUpdate(current.doc, Y.encodeStateVector(browser)));
  assert.equal(browser.getText('content').toString(), 'the assistant rewrote this\n');
  await collab.flushProject(user.id, id);
  await collab.releaseRoom(current);
  assert.equal(await fs.readFile(file, 'utf8'), 'the assistant rewrote this\n');
});
