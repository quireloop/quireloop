import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Must be set before anything imports config.js, which freezes it into a
// module constant — the folder a project is opened from, in place.
const libraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'quireloop-synctex-'));
process.env.QUIRELOOP_LIBRARY_DIRS = `Papers=${libraryRoot}`;

const { getTestApp, signup, createProject } = await import('./helpers.js');
const { execa } = await import('execa');
// After getTestApp(): synctex.js pulls in config.js, which must see the test
// data dir rather than freeze the default one.
await getTestApp();
const { parseViewRecords } = await import('../src/lib/synctex.js');

after(async () => {
  const { cleanup } = await getTestApp();
  await cleanup();
  await fs.rm(libraryRoot, { recursive: true, force: true });
});

const hasTex = await Promise.all(
  ['latexmk', 'synctex'].map((cmd) =>
    execa(cmd, ['--version'], { reject: false })
      .then((r) => r.exitCode === 0)
      .catch(() => false)
  )
).then((all) => all.every(Boolean));
const skip = !hasTex && 'latexmk/synctex not installed';

const post = (app, cookie, url, payload) =>
  app.inject({ method: 'POST', url, headers: { cookie }, payload });

async function compile(app, cookie, id) {
  const res = await post(app, cookie, `/api/projects/${id}/compile`);
  assert.equal(res.statusCode, 200);
  const result = res.json();
  assert.equal(result.success, true, `compile failed:\n${result.log?.slice(-2000)}`);
}

test('both directions resolve for a project opened in place from a server folder', { skip }, async () => {
  // The regression: synctex reports the folder's real path, while the
  // project directory is a symlink to it — so every PDF click came back as
  // a "../../.." path that matched no editor tab.
  const paper = path.join(libraryRoot, 'paper');
  await fs.mkdir(path.join(paper, 'sec'), { recursive: true });
  await fs.writeFile(
    path.join(paper, 'main.tex'),
    '\\documentclass{article}\n\\begin{document}\nOpening paragraph in the main file.\n\n\\input{sec/intro}\n\\end{document}\n'
  );
  await fs.writeFile(path.join(paper, 'sec', 'intro.tex'), 'Introduction text that lives in a subfile.\n');

  const { app } = await getTestApp();
  const { cookie } = await signup(app, 'synctex-linked@example.com');
  const opened = await post(app, cookie, '/api/projects/open-folder', { path: paper, name: 'In place' });
  assert.equal(opened.statusCode, 201, opened.body);
  const { id } = opened.json();
  await compile(app, cookie, id);

  const forward = await post(app, cookie, `/api/projects/${id}/synctex/to-pdf`, { file: 'sec/intro.tex', line: 1 });
  assert.equal(forward.statusCode, 200, forward.body);
  const where = forward.json();
  assert.equal(where.page, 1);
  assert.ok(where.boxes.length >= 1, 'forward sync should return the boxes to highlight');
  assert.ok(where.boxes.every((b) => b.W >= 0 && b.H >= 0));

  // Click inside the first box (just above its baseline) and expect to land
  // back on the same file and line.
  const box = where.boxes[0];
  const back = await post(app, cookie, `/api/projects/${id}/synctex/to-source`, {
    page: box.page,
    x: box.h + Math.max(1, box.W / 2),
    y: box.v - Math.max(1, box.H / 2),
  });
  assert.equal(back.statusCode, 200, back.body);
  assert.equal(back.json().file, path.join('sec', 'intro.tex'));
  assert.equal(back.json().line, 1);
});

test('a main file inside a subfolder compiles, serves its PDF and syncs', { skip }, async () => {
  const { app } = await getTestApp();
  const { cookie } = await signup(app, 'synctex-nested@example.com');
  const project = await createProject(app, cookie, 'Nested main');

  const put = await app.inject({
    method: 'PUT',
    url: `/api/projects/${project.id}/files/ms/paper.tex`,
    headers: { cookie, 'content-type': 'text/plain' },
    payload: '\\documentclass{article}\n\\begin{document}\nA paper whose main file is not at the root.\n\\end{document}\n',
  });
  assert.ok(put.statusCode < 300, put.body);
  const patched = await app.inject({
    method: 'PATCH',
    url: `/api/projects/${project.id}`,
    headers: { cookie },
    payload: { mainFile: 'ms/paper.tex' },
  });
  assert.equal(patched.statusCode, 200, patched.body);

  // latexmk writes build/paper.pdf for ms/paper.tex; looking for
  // build/ms/paper.pdf made this report failure despite a good PDF.
  await compile(app, cookie, project.id);
  const pdf = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/pdf`, headers: { cookie } });
  assert.equal(pdf.statusCode, 200);

  const forward = await post(app, cookie, `/api/projects/${project.id}/synctex/to-pdf`, { file: 'ms/paper.tex', line: 3 });
  assert.equal(forward.statusCode, 200, forward.body);
});

test('malformed sync requests are refused before reaching synctex', async () => {
  const { app } = await getTestApp();
  const { cookie } = await signup(app, 'synctex-input@example.com');
  const project = await createProject(app, cookie, 'Bad input');
  const url = (dir) => `/api/projects/${project.id}/synctex/${dir}`;

  for (const payload of [{ page: '1', x: 1, y: 1 }, { page: 1, x: -1, y: 1 }, { page: 0, x: 1, y: 1 }, {}]) {
    assert.equal((await post(app, cookie, url('to-source'), payload)).statusCode, 400, JSON.stringify(payload));
  }
  for (const payload of [{ file: 'a:b.tex', line: 1 }, { file: 'main.tex', line: 0 }, { file: '', line: 1 }]) {
    assert.equal((await post(app, cookie, url('to-pdf'), payload)).statusCode, 400, JSON.stringify(payload));
  }
});

test('synctex view output is parsed into de-duplicated boxes', () => {
  const stdout = [
    'SyncTeX result begin',
    'Output:build/main.pdf',
    'Page:1', 'x:171.1', 'y:134.7', 'h:133.7', 'v:134.7', 'W:343.7', 'H:6.9', 'B:0', 'M:0', 'Before:', 'Offset:0', 'Middle:', 'After:',
    'Output:build/main.pdf',
    'Page:1', 'x:171.1', 'y:134.7', 'h:133.7', 'v:134.7', 'W:343.7', 'H:6.9',
    'Output:build/main.pdf',
    'Page:2', 'x:90', 'y:100', 'h:90', 'v:100', 'W:200', 'H:7',
    'SyncTeX result end',
  ].join('\n');
  const boxes = parseViewRecords(stdout);
  assert.equal(boxes.length, 2);
  assert.deepEqual(boxes[1], { page: 2, x: 90, y: 100, h: 90, v: 100, W: 200, H: 7 });
});

const { sandboxAvailable } = await import('../src/lib/compileSandbox.js');
const sandboxSkip = skip || (!(await sandboxAvailable()) && 'bubblewrap cannot run here');

test('a project .latexmkrc never runs', { skip }, async () => {
  const ran = path.join(libraryRoot, 'rc-ran');
  const paper = path.join(libraryRoot, 'with-rc');
  await fs.mkdir(paper);
  await fs.writeFile(path.join(paper, '.latexmkrc'), `system("touch ${ran}");\n`);
  await fs.writeFile(path.join(paper, 'main.tex'), '\\documentclass{article}\n\\begin{document}\nBody.\n\\end{document}\n');

  const { app } = await getTestApp();
  const { cookie } = await signup(app, 'latexmkrc@example.com');
  const opened = await post(app, cookie, '/api/projects/open-folder', { path: paper, name: 'With rc' });
  assert.equal(opened.statusCode, 201, opened.body);
  await compile(app, cookie, opened.json().id);

  await fs.access(path.join(paper, 'build', 'main.pdf'));
  await assert.rejects(fs.access(ran), 'the project .latexmkrc must not run');
});

// Only the sandbox keeps a compile from reading outside its project: since
// TeX Live 2026, openin_any is ignored, so without bubblewrap TeX reads any
// file the server can.
test('a compile cannot read outside its project', { skip: sandboxSkip }, async () => {
  const secret = path.join(libraryRoot, 'secret.txt');
  await fs.writeFile(secret, 'OUTSIDE-THE-PROJECT\n');
  const paper = path.join(libraryRoot, 'sandboxed');
  await fs.mkdir(paper);
  await fs.writeFile(
    path.join(paper, 'main.tex'),
    `\\documentclass{article}\n\\begin{document}\n\\newread\\f\\openin\\f=${secret}\n` +
      '\\ifeof\\f\\typeout{NOREAD}\\else\\read\\f to\\x\\typeout{LEAKED:\\x}\\fi\nBody.\n\\end{document}\n'
  );

  const { app } = await getTestApp();
  const { cookie } = await signup(app, 'sandbox@example.com');
  const opened = await post(app, cookie, '/api/projects/open-folder', { path: paper, name: 'Sandboxed' });
  assert.equal(opened.statusCode, 201, opened.body);
  await compile(app, cookie, opened.json().id);

  const log = await fs.readFile(path.join(paper, 'build', 'main.log'), 'utf8');
  assert.match(log, /NOREAD/);
  assert.doesNotMatch(log, /LEAKED/);
});

test('a compile gets a clean environment and leaves no symlinks in build', { skip }, async () => {
  const { sandboxCommand, removeSymlinks } = await import('../src/lib/compileSandbox.js');
  process.env.QUIRELOOP_ANTHROPIC_API_KEY = 'must-not-leak';
  try {
    const { options } = await sandboxCommand(libraryRoot, ['latexmk']);
    assert.equal(options.extendEnv, false);
    assert.equal(options.env.QUIRELOOP_ANTHROPIC_API_KEY, undefined);
    assert.equal(options.env.openin_any, 'p');
  } finally {
    delete process.env.QUIRELOOP_ANTHROPIC_API_KEY;
  }

  const build = path.join(libraryRoot, 'links', 'build');
  await fs.mkdir(path.join(build, 'nested'), { recursive: true });
  await fs.writeFile(path.join(build, 'main.log'), 'kept');
  await fs.symlink('/etc/hostname', path.join(build, 'main.pdf'));
  await fs.symlink('/etc/hostname', path.join(build, 'nested', 'x'));
  await removeSymlinks(build);
  assert.deepEqual((await fs.readdir(build)).sort(), ['main.log', 'nested']);
  assert.deepEqual(await fs.readdir(path.join(build, 'nested')), []);
});

test('LuaLaTeX cannot reach anything outside the sandbox', { skip: sandboxSkip }, async () => {
  const secret = path.join(libraryRoot, 'lua-secret.txt');
  const escaped = path.join(libraryRoot, 'lua-escaped.txt');
  await fs.writeFile(secret, 'TOPSECRET');
  const paper = path.join(libraryRoot, 'lua');
  await fs.mkdir(path.join(paper, '.git', 'hooks'), { recursive: true });
  await fs.writeFile(
    path.join(paper, 'main.tex'),
    `\\documentclass{article}\n\\begin{document}\n\\directlua{
      local f = io.open("${secret}", "r")
      texio.write_nl("SECRET:" .. tostring(f and f:read("*a")))
      local g = io.open("${escaped}", "w")
      texio.write_nl("ESCAPE:" .. tostring(g ~= nil))
      local h = io.open("${paper}/.git/hooks/pre-commit", "w")
      texio.write_nl("HOOK:" .. tostring(h ~= nil))
      local s = io.open("${paper}/main.tex", "a")
      texio.write_nl("SOURCE:" .. tostring(s ~= nil))
      local b = io.open("build/written.txt", "w")
      texio.write_nl("BUILD:" .. tostring(b ~= nil))
      if b then b:close() end
    }\nBody.\n\\end{document}\n`
  );

  const { app } = await getTestApp();
  const { cookie } = await signup(app, 'lua-sandbox@example.com');
  const opened = await post(app, cookie, '/api/projects/open-folder', { path: paper, name: 'Lua' });
  assert.equal(opened.statusCode, 201, opened.body);
  const id = opened.json().id;
  await app.inject({ method: 'PATCH', url: `/api/projects/${id}`, headers: { cookie }, payload: { compiler: 'lualatex' } });
  await compile(app, cookie, id);

  const log = await fs.readFile(path.join(paper, 'build', 'main.log'), 'utf8');
  assert.match(log, /SECRET:nil/);
  assert.doesNotMatch(log, /TOPSECRET/);
  assert.match(log, /HOOK:false/);
  assert.match(log, /SOURCE:false/);
  assert.match(log, /BUILD:true/);
  // /tmp is private inside the box, so that write may appear to work there.
  await assert.rejects(fs.access(escaped), 'nothing may reach the real disk');
});
