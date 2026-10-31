import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';

// Must be set before anything imports config.js.
const libraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'quireloop-security-'));
process.env.QUIRELOOP_LIBRARY_DIRS = `Papers=${libraryRoot}`;

const { getTestApp, signup, createProject } = await import('./helpers.js');
const { app, cleanup } = await getTestApp();
const { projectDir } = await import('../src/lib/storage.js');
const { isSafeMainFile } = await import('../src/lib/latex.js');
const { gitStatus } = await import('../src/lib/projectGit.js');
const { readManifest } = await import('../src/lib/manifest.js');

after(async () => {
  await cleanup();
  await fs.rm(libraryRoot, { recursive: true, force: true });
});

const owner = await signup(app, 'sec-owner@example.com');
const viewer = await signup(app, 'sec-viewer@example.com');
const project = await createProject(app, owner.cookie, 'Secure');
const id = project.id;
const ownerId = (await readManifest(...(await findOwner()))).ownerId;

async function findOwner() {
  const { getOwner } = await import('../src/lib/projectIndex.js');
  return [await getOwner(id), id];
}

const call = (method, url, cookie, payload) => app.inject({ method, url, headers: { cookie }, payload });
const dir = projectDir(ownerId, id);

await call('POST', `/api/projects/${id}/share`, owner.cookie, { email: 'sec-viewer@example.com', role: 'viewer' });
await call('POST', `/api/projects/${id}/git/remote`, owner.cookie, { url: 'https://example.com/r.git', token: 'SECRET-TOKEN' });

test('private files cannot be read, written, renamed or deleted', async () => {
  const privatePaths = ['.git/config', 'manifest.json', '.quireloop-remote.json', 'versions/index.json', '.GIT/config'];
  for (const file of privatePaths) {
    const read = await call('GET', `/api/projects/${id}/files/${file}`, viewer.cookie);
    assert.equal(read.statusCode, 404, file);
    assert.doesNotMatch(read.body, /SECRET-TOKEN/);
    const write = await call('PUT', `/api/projects/${id}/files/${file}`, owner.cookie, { content: 'x' });
    assert.equal(write.statusCode, 400, file);
  }
  const before = await fs.readFile(path.join(dir, '.git', 'config'), 'utf8');
  assert.equal((await call('POST', `/api/projects/${id}/rename`, owner.cookie, { oldPath: 'main.tex', newPath: '.git/config' })).statusCode, 400);
  assert.equal((await call('POST', `/api/projects/${id}/rename`, owner.cookie, { oldPath: '.git', newPath: 'g' })).statusCode, 400);
  assert.equal(await fs.readFile(path.join(dir, '.git', 'config'), 'utf8'), before);
});

test('the whole project cannot be deleted through the file routes', async () => {
  for (const paths of [['.'], [''], ['.git'], ['versions']]) {
    const res = await call('POST', `/api/projects/${id}/files/delete-many`, owner.cookie, { paths });
    assert.equal(res.statusCode, 400, JSON.stringify(paths));
  }
  await fs.access(path.join(dir, 'main.tex'));
});

test('a link cannot reach a file outside the project', async () => {
  const secret = path.join(libraryRoot, 'secret.txt');
  await fs.writeFile(secret, 'OUTSIDE');
  await fs.symlink(secret, path.join(dir, 'link.txt'));
  await fs.symlink('/nonexistent/place', path.join(dir, 'dangling.txt'));
  await fs.symlink(libraryRoot, path.join(dir, 'linkdir'));

  assert.equal((await call('GET', `/api/projects/${id}/files/link.txt`, owner.cookie)).statusCode, 404);
  assert.equal((await call('PUT', `/api/projects/${id}/files/link.txt`, owner.cookie, { content: 'x' })).statusCode, 400);
  assert.equal((await call('PUT', `/api/projects/${id}/files/dangling.txt`, owner.cookie, { content: 'x' })).statusCode, 400);
  assert.equal((await call('PUT', `/api/projects/${id}/files/linkdir/new.txt`, owner.cookie, { content: 'x' })).statusCode, 400);
  await assert.rejects(fs.access(path.join(libraryRoot, 'new.txt')));
  assert.equal(await fs.readFile(secret, 'utf8'), 'OUTSIDE');

  const search = await call('GET', `/api/projects/${id}/search?q=OUTSIDE`, owner.cookie);
  assert.deepEqual(search.json().matches, []);

  await fs.mkdir(path.join(dir, 'build'), { recursive: true });
  await fs.symlink(secret, path.join(dir, 'build', 'main.pdf'));
  const pdf = await call('GET', `/api/projects/${id}/pdf`, owner.cookie);
  assert.equal(pdf.statusCode, 404);
  await fs.rm(path.join(dir, 'build', 'main.pdf'));
  for (const name of ['link.txt', 'dangling.txt', 'linkdir']) await fs.rm(path.join(dir, name));
});

test('normal file work still works, including new folders', async () => {
  const put = await call('PUT', `/api/projects/${id}/files/sections/deep/intro.tex`, owner.cookie, { content: 'hello' });
  assert.equal(put.statusCode, 200, put.body);
  const get = await call('GET', `/api/projects/${id}/files/sections/deep/intro.tex`, viewer.cookie);
  assert.equal(get.body, 'hello');
  assert.equal((await call('PUT', `/api/projects/${id}/files/.gitignore`, owner.cookie, { content: 'x\n' })).statusCode, 200);
  assert.equal((await call('POST', `/api/projects/${id}/rename`, owner.cookie, { oldPath: 'sections/deep/intro.tex', newPath: 'sections/intro.tex' })).statusCode, 200);
});

test('snapshots and downloads do not hand out the git token', async () => {
  const snap = await call('POST', `/api/projects/${id}/versions`, owner.cookie, {});
  const vid = snap.json().id;
  const res = await call('GET', `/api/projects/${id}/versions/${vid}/file?path=.quireloop-remote.json`, viewer.cookie);
  assert.equal(res.statusCode, 400);
  assert.doesNotMatch(res.body, /SECRET-TOKEN/);

  const zip = await call('GET', `/api/projects/${id}/download`, viewer.cookie);
  assert.equal(zip.statusCode, 200);
  assert.doesNotMatch(zip.rawPayload.toString('latin1'), /quireloop-remote|\.git\/config/);
});

test('the git token is never committed, even if .gitignore is changed', async () => {
  await fs.writeFile(path.join(dir, '.gitignore'), '');
  const res = await call('POST', `/api/projects/${id}/git/commit`, owner.cookie, { message: 'try' });
  assert.equal(res.statusCode, 200, res.body);
  const { stdout } = await execa('git', ['-C', dir, 'ls-files']);
  assert.doesNotMatch(stdout, /quireloop-remote/);
});

test('a repository with commands in its config is refused', async () => {
  const marker = path.join(libraryRoot, 'ran');
  const paper = path.join(libraryRoot, 'evil');
  await fs.mkdir(paper);
  await fs.writeFile(path.join(paper, 'main.tex'), 'x');
  await fs.writeFile(path.join(paper, 'a.tex'), 'y');
  await execa('git', ['init', '-q', paper]);
  await execa('git', ['-C', paper, 'config', 'filter.x.clean', `touch ${marker}`]);
  await fs.writeFile(path.join(paper, '.gitattributes'), '*.tex filter=x\n');

  const opened = await call('POST', '/api/projects/open-folder', owner.cookie, { path: paper, name: 'Evil' });
  assert.equal(opened.statusCode, 201, opened.body);
  await assert.rejects(gitStatus(ownerId, opened.json().id), /git settings/);
  await assert.rejects(fs.access(marker));
});

test('git never runs a hook or follows the hooks setting', async () => {
  const marker = path.join(libraryRoot, 'hook-ran');
  const hook = path.join(dir, '.git', 'hooks', 'pre-commit');
  await fs.writeFile(hook, `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
  await fs.writeFile(path.join(dir, 'main.tex'), 'changed\n');
  const res = await call('POST', `/api/projects/${id}/git/commit`, owner.cookie, { message: 'hook' });
  assert.equal(res.statusCode, 200, res.body);
  await assert.rejects(fs.access(marker));
});

test('an uploaded zip cannot bring its own git config', async () => {
  const marker = path.join(libraryRoot, 'zip-ran');
  const src = path.join(libraryRoot, 'zipsrc');
  await execa('git', ['init', '-q', src]);
  await fs.writeFile(path.join(src, 'main.tex'), 'x');
  await execa('git', ['-C', src, 'config', 'core.fsmonitor', `touch ${marker}`]);
  const zipPath = path.join(libraryRoot, 'up.zip');
  await execa('zip', ['-qr', zipPath, '.'], { cwd: src });

  const { importFromZip } = await import('../src/lib/zipImport.js');
  const manifest = await importFromZip(ownerId, 'Zipped', await fs.readFile(zipPath));
  const config = await fs.readFile(path.join(projectDir(ownerId, manifest.id), '.git', 'config'), 'utf8');
  assert.doesNotMatch(config, /fsmonitor/);
  await assert.rejects(fs.access(marker));
});

test('a main file cannot be turned into a latexmk option', async () => {
  for (const bad of ['-e=system("id").tex', 'a/-x.tex', '../main.tex', '/etc/x.tex', 'main.pdf', 42]) {
    assert.equal(isSafeMainFile(bad), false, String(bad));
  }
  assert.equal(isSafeMainFile('ms/paper.tex'), true);
  const res = await call('PATCH', `/api/projects/${id}`, owner.cookie, { mainFile: '-e=x.tex' });
  assert.equal(res.statusCode, 400);
});
