import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execa } from 'execa';
import { getTestApp, signup, createProject } from './helpers.js';

// One app (and one data dir) per file — see the note in helpers.js.
after(async () => {
  const { cleanup } = await getTestApp();
  await cleanup();
});

// latexmk is an external dependency the app shells out to; skip rather than
// fail on a machine that doesn't have a TeX distribution installed.
const hasLatexmk = await execa('latexmk', ['--version'], { reject: false })
  .then((r) => r.exitCode === 0)
  .catch(() => false);

test('a template project compiles to a PDF', { skip: !hasLatexmk && 'latexmk not installed' }, async () => {
  const { app } = await getTestApp();
  const { cookie } = await signup(app, 'compiler@example.com');
  const project = await createProject(app, cookie, 'Compiles');

  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/compile`,
    headers: { cookie },
  });
  assert.equal(res.statusCode, 200);
  const result = res.json();
  assert.equal(result.success, true, `compile failed:\n${result.log?.slice(-2000)}`);

  const pdf = await app.inject({
    method: 'GET',
    url: `/api/projects/${project.id}/pdf`,
    headers: { cookie },
  });
  assert.equal(pdf.statusCode, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.ok(pdf.rawPayload.length > 1000, 'the PDF should have real content');
  assert.equal(pdf.rawPayload.subarray(0, 4).toString(), '%PDF', 'response should be a real PDF');
});

test(
  'a LaTeX error is reported as structured problems, not just a log dump',
  { skip: !hasLatexmk && 'latexmk not installed' },
  async () => {
    const { app } = await getTestApp();
    const { cookie } = await signup(app, 'broken@example.com');
    const project = await createProject(app, cookie, 'Broken');

    await app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/files/main.tex`,
      headers: { cookie, 'content-type': 'text/plain' },
      payload: '\\documentclass{article}\n\\begin{document}\n\\thisCommandDoesNotExist\n\\end{document}\n',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/compile`,
      headers: { cookie },
    });
    assert.equal(res.statusCode, 200, 'a LaTeX error is a result, not a server error');
    const result = res.json();
    assert.ok(Array.isArray(result.problems), 'problems should be a parsed array');
    assert.ok(result.problems.length > 0, 'an undefined control sequence should be reported');
    assert.ok(
      result.problems.some((p) => /undefined control sequence/i.test(p.message ?? '')),
      `expected an "undefined control sequence" problem, got: ${JSON.stringify(result.problems)}`
    );
  }
);

test(
  'concurrent compiles of the same project do not corrupt each other',
  { skip: !hasLatexmk && 'latexmk not installed' },
  async () => {
    const { app } = await getTestApp();
    const { cookie } = await signup(app, 'racer@example.com');
    const project = await createProject(app, cookie, 'Race');

    // These share one build/ directory. Unserialized, they interleave writes to
    // the same .aux/.fls files and can each poison the other's run.
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        app
          .inject({ method: 'POST', url: `/api/projects/${project.id}/compile`, headers: { cookie } })
          .then((r) => r.json())
      )
    );

    for (const [i, result] of results.entries()) {
      assert.equal(result.success, true, `compile ${i} failed:\n${result.log?.slice(-1500)}`);
    }
  }
);

test('every successful compile is snapshotted in version history', { skip: !hasLatexmk && 'latexmk not installed' }, async () => {
  const { app } = await getTestApp();
  const { cookie } = await signup(app, 'versions@example.com');
  const project = await createProject(app, cookie, 'Versioned');

  await app.inject({ method: 'POST', url: `/api/projects/${project.id}/compile`, headers: { cookie } });
  await app.inject({ method: 'POST', url: `/api/projects/${project.id}/compile`, headers: { cookie } });

  const versions = await app
    .inject({ method: 'GET', url: `/api/projects/${project.id}/versions`, headers: { cookie } })
    .then((r) => r.json());

  const autos = versions.filter((v) => v.trigger === 'compile');
  assert.equal(autos.length, 2, 'each successful compile should leave one snapshot');
});
