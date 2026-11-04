import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getTestApp, signup, createProject } from './helpers.js';

const { app, cleanup } = await getTestApp();
const { autosaveIfChanged, listVersions, restoreVersion } = await import('../src/lib/versions.js');
const { projectDir } = await import('../src/lib/storage.js');
const { cookie, user } = await signup(app, 'autosave@example.com');
after(cleanup);

async function freshProject(name) {
  const project = await createProject(app, cookie, name);
  return { id: project.id, dir: projectDir(user.id, project.id) };
}

test('a change to the writing is saved, and an unchanged project is not', async () => {
  const { id, dir } = await freshProject('Writing');
  assert.ok(await autosaveIfChanged(user.id, id), 'the first look saves what is there');
  assert.equal(await autosaveIfChanged(user.id, id), null);

  await fs.writeFile(path.join(dir, 'main.tex'), 'edited by another program\n');
  const saved = await autosaveIfChanged(user.id, id);
  assert.ok(saved);
  const [latest] = await listVersions(user.id, id);
  assert.equal(latest.trigger, 'autosave');
  assert.equal(latest.textOnly, true);
  assert.equal(await fs.readFile(path.join(dir, 'versions', saved.id, 'main.tex'), 'utf8'), 'edited by another program\n');
});

test('a new file time with the same text is not a new version', async () => {
  const { id, dir } = await freshProject('Same text');
  await autosaveIfChanged(user.id, id);
  const later = new Date(Date.now() + 5000);
  await fs.utimes(path.join(dir, 'main.tex'), later, later);
  assert.equal(await autosaveIfChanged(user.id, id), null);
});

test('figures, the build folder and Quireloop bookkeeping stay out', async () => {
  const { id, dir } = await freshProject('Lean');
  await fs.writeFile(path.join(dir, 'figures', 'plot.png'), Buffer.alloc(2048));
  await fs.mkdir(path.join(dir, 'build'), { recursive: true });
  await fs.writeFile(path.join(dir, 'build', 'main.log'), 'log');
  await fs.mkdir(path.join(dir, 'sec'));
  await fs.writeFile(path.join(dir, 'sec', 'intro.tex'), 'intro\n');
  await fs.writeFile(path.join(dir, 'refs.bib'), '@misc{a}\n');
  const saved = await autosaveIfChanged(user.id, id);
  const kept = await fs.readdir(path.join(dir, 'versions', saved.id), { recursive: true });
  assert.deepEqual(kept.map((p) => p.split(path.sep).join('/')).sort(), ['main.tex', 'refs.bib', 'sec', 'sec/intro.tex']);
});

test('restoring an autosave brings the writing back and leaves other files alone', async () => {
  const { id, dir } = await freshProject('Restore');
  await fs.writeFile(path.join(dir, 'main.tex'), 'the good draft\n');
  const good = await autosaveIfChanged(user.id, id);

  await fs.writeFile(path.join(dir, 'main.tex'), 'a bad rewrite\n');
  await fs.writeFile(path.join(dir, 'figures', 'new.png'), Buffer.alloc(16));
  await autosaveIfChanged(user.id, id);

  await restoreVersion(user.id, id, good.id);
  assert.equal(await fs.readFile(path.join(dir, 'main.tex'), 'utf8'), 'the good draft\n');
  await fs.access(path.join(dir, 'figures', 'new.png'));
  const [beforeRestore] = await listVersions(user.id, id);
  assert.equal(beforeRestore.trigger, 'restore', 'the state before restoring is kept too');
});
