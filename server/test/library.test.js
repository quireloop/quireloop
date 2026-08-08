import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Must be set before anything imports config.js, which freezes it into a
// module constant — see the note in helpers.js.
const libraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'quireloop-library-'));
const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'quireloop-outside-'));
process.env.QUIRELOOP_LIBRARY_DIRS = `Papers=${libraryRoot}`;

const { getTestApp, signup } = await import('./helpers.js');
const { execa } = await import('execa');

const hasLatexmk = await execa('latexmk', ['--version'], { reject: false })
  .then((r) => r.exitCode === 0)
  .catch(() => false);

let app;
let cookie;
let paperDir;

before(async () => {
  ({ app } = await getTestApp());
  ({ cookie } = await signup(app, 'library@example.com'));

  paperDir = path.join(libraryRoot, 'thesis');
  await fs.mkdir(path.join(paperDir, 'figures'), { recursive: true });
  await fs.writeFile(
    path.join(paperDir, 'main.tex'),
    '\\documentclass{article}\n\\begin{document}\nHello from disk.\n\\end{document}\n'
  );
  await fs.writeFile(path.join(paperDir, 'refs.bib'), '@article{x, title={X}}\n');
  await fs.mkdir(path.join(libraryRoot, 'empty'), { recursive: true });
  await fs.writeFile(path.join(outsideRoot, 'secret.tex'), 'not yours\n');
});

after(async () => {
  const { cleanup } = await getTestApp();
  await cleanup();
  await fs.rm(libraryRoot, { recursive: true, force: true });
  await fs.rm(outsideRoot, { recursive: true, force: true });
});

const browse = (p) =>
  app.inject({ method: 'GET', url: `/api/library/browse?path=${encodeURIComponent(p)}`, headers: { cookie } });

const openFolder = (p, name) =>
  app.inject({ method: 'POST', url: '/api/projects/open-folder', headers: { cookie }, payload: { path: p, name } });

test('the configured roots are advertised to the client', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/library/roots', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.enabled, true);
  assert.equal(body.roots.length, 1);
  assert.equal(body.roots[0].label, 'Papers');
});

test('browsing lists subfolders and the LaTeX files in them', async () => {
  const res = await browse(libraryRoot);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.parent, null, 'a root has no parent to climb to');
  assert.deepEqual(
    body.folders.map((f) => f.name),
    ['empty', 'thesis']
  );

  const inner = (await browse(paperDir)).json();
  assert.deepEqual(inner.texFiles, ['main.tex', 'refs.bib']);
  assert.equal(inner.parent, await fs.realpath(libraryRoot));
});

test('browsing outside the configured roots is refused', async () => {
  for (const attempt of [outsideRoot, '/etc', path.join(libraryRoot, '..'), `${libraryRoot}/../../etc`]) {
    const res = await browse(attempt);
    assert.equal(res.statusCode, 404, `browsing "${attempt}" should be refused`);
    assert.ok(!res.body.includes('passwd'), `browsing "${attempt}" leaked a directory listing`);
  }
});

// The containment check resolves symlinks on purpose: a link planted inside a
// root satisfies any check that only compares path strings.
test('a symlink inside a root cannot be used to escape it', async () => {
  const escape = path.join(libraryRoot, 'escape-hatch');
  await fs.symlink(outsideRoot, escape, 'dir');
  try {
    assert.equal((await browse(escape)).statusCode, 404);
    assert.equal((await openFolder(escape)).statusCode, 404);
    // It must also not show up as a folder to click on in the parent listing.
    const listing = (await browse(libraryRoot)).json();
    assert.ok(
      !listing.folders.some((f) => f.name === 'escape-hatch'),
      'a link out of the root should not be listed as a browsable folder'
    );
  } finally {
    await fs.rm(escape, { force: true });
  }
});

test('opening a folder edits it in place rather than copying it', async () => {
  const res = await openFolder(paperDir, 'Thesis');
  assert.equal(res.statusCode, 201, res.body);
  const project = res.json();
  assert.equal(project.name, 'Thesis');
  assert.equal(project.linkedPath, await fs.realpath(paperDir));
  assert.equal(project.mainFile, 'main.tex');

  // Reading through the project API returns what's on disk...
  const read = await app.inject({
    method: 'GET',
    url: `/api/projects/${project.id}/files/main.tex`,
    headers: { cookie },
  });
  assert.match(read.body, /Hello from disk/);

  // ...and writing through it lands in the user's own folder, not a copy.
  const write = await app.inject({
    method: 'PUT',
    url: `/api/projects/${project.id}/files/main.tex`,
    headers: { cookie, 'content-type': 'text/plain' },
    payload: 'edited via quireloop\n',
  });
  assert.ok(write.statusCode < 300, write.body);
  assert.equal(await fs.readFile(path.join(paperDir, 'main.tex'), 'utf8'), 'edited via quireloop\n');

  // It appears on the dashboard like any other project.
  const list = (await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie } })).json();
  assert.ok(list.some((p) => p.id === project.id), 'a linked project should be listed');
});

test('the same folder cannot be opened twice', async () => {
  const res = await openFolder(paperDir);
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /already open/);
});

test('an empty folder is refused, and leaves no dangling project behind', async () => {
  const res = await openFolder(path.join(libraryRoot, 'empty'));
  assert.equal(res.statusCode, 400);

  const list = (await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie } })).json();
  assert.equal(list.length, 1, 'a failed open must not leave a half-created project');
});

// The one call in the app that could destroy a user's own work.
test('removing a linked project does not delete the real folder', async () => {
  const source = path.join(libraryRoot, 'disposable');
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, 'paper.tex'), '\\documentclass{article}\n');

  const project = (await openFolder(source, 'Disposable')).json();
  const res = await app.inject({ method: 'DELETE', url: `/api/projects/${project.id}`, headers: { cookie } });
  assert.equal(res.statusCode, 204);

  assert.deepEqual(
    (await fs.readdir(source)).sort(),
    ['manifest.json', 'paper.tex'],
    "the user's files must survive removing the project"
  );
  // The slot under data/projects is gone, so the project is really unlisted.
  const list = (await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie } })).json();
  assert.ok(!list.some((p) => p.id === project.id));
});

test('opening a folder does not turn it into a git repo', async () => {
  const source = path.join(libraryRoot, 'not-a-repo');
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, 'paper.tex'), '\\documentclass{article}\n');

  await openFolder(source, 'Not a repo');
  await assert.rejects(fs.stat(path.join(source, '.git')), "git init must not run in the user's own folder");
  await assert.rejects(fs.stat(path.join(source, '.gitignore')));
});

// The point of the symlinked project slot is that every downstream feature
// keeps working unchanged. Compile is the one that most obviously would not,
// since it shells out to latexmk with a working directory.
test('a linked folder compiles, with the PDF landing next to the sources', { skip: !hasLatexmk && 'latexmk not installed' }, async () => {
  const source = path.join(libraryRoot, 'compilable');
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(
    path.join(source, 'main.tex'),
    '\\documentclass{article}\n\\begin{document}\nLinked and compiled.\n\\end{document}\n'
  );

  const project = (await openFolder(source, 'Compilable')).json();
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/compile`,
    headers: { cookie },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().success, true, `compile failed:\n${res.json().log?.slice(-1500)}`);
  assert.ok((await fs.stat(path.join(source, 'build', 'main.pdf'))).size > 1000);
});

test('the library API rejects unauthenticated callers', async () => {
  for (const [method, url] of [
    ['GET', '/api/library/roots'],
    ['GET', `/api/library/browse?path=${encodeURIComponent(libraryRoot)}`],
    ['POST', '/api/projects/open-folder'],
  ]) {
    const res = await app.inject({ method, url, payload: { path: libraryRoot } });
    assert.equal(res.statusCode, 401, `${method} ${url} should require authentication`);
  }
});
