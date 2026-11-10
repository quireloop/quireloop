import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { getTestApp, signup, createProject } from './helpers.js';

const { app, cleanup } = await getTestApp();
after(cleanup);

function as(cookie, method, url, { payload, host } = {}) {
  return app.inject({ method, url, payload, headers: { cookie, ...(host ? { host } : {}) } });
}

async function guides(cookie) {
  const projects = (await as(cookie, 'GET', '/api/projects')).json();
  return projects.filter((p) => p.name.startsWith('Quireloop guide'));
}

test('an account gets one guide on its first visit, and never a second', async () => {
  const { cookie } = await signup(app, 'first-visit@example.com');
  assert.equal((await guides(cookie)).length, 0);
  await as(cookie, 'GET', '/api/auth/me', { host: 'localhost:4173' });
  await as(cookie, 'GET', '/api/auth/me', { host: 'localhost:4173' });
  const [guide, ...extra] = await guides(cookie);
  assert.equal(extra.length, 0);
  assert.equal(guide.name, 'Quireloop guide');

  const manifest = (await as(cookie, 'GET', `/api/projects/${guide.id}`)).json();
  assert.equal(manifest.mainFile, 'main.tex');
  assert.ok(manifest.files.some((f) => f.path === 'figures/project.jpg'), 'the screenshots come along');
  const text = (await as(cookie, 'GET', `/api/projects/${guide.id}/files/main.tex`)).body;
  assert.match(text, /On your own computer/);
  assert.doesNotMatch(text, /For administrators/);
  assert.doesNotMatch(text, /%%%% /, 'the section markers are removed');
});

test('a deleted guide stays deleted', async () => {
  const { cookie } = await signup(app, 'deleter@example.com');
  await as(cookie, 'GET', '/api/auth/me', { host: 'localhost:4173' });
  const [guide] = await guides(cookie);
  assert.equal((await as(cookie, 'DELETE', `/api/projects/${guide.id}`)).statusCode, 204);
  await as(cookie, 'GET', '/api/auth/me', { host: 'localhost:4173' });
  assert.equal((await guides(cookie)).length, 0);
});

test('on a server the guide covers the server, not a personal install', async () => {
  const { cookie } = await signup(app, 'server-user@example.com');
  await as(cookie, 'GET', '/api/auth/me', { host: 'labserver.example' });
  const [guide] = await guides(cookie);
  assert.equal(guide.name, 'Quireloop guide (server)');
  const text = (await as(cookie, 'GET', `/api/projects/${guide.id}/files/main.tex`)).body;
  assert.match(text, /On the lab server/);
  assert.doesNotMatch(text, /A backup folder/);
});

test('a version can be named, renamed and given back its default name', async () => {
  const { cookie } = await signup(app, 'namer@example.com');
  const project = await createProject(app, cookie, 'Named versions');
  const { id } = (await as(cookie, 'POST', `/api/projects/${project.id}/versions`, { payload: {} })).json();
  const rename = (label) => as(cookie, 'PATCH', `/api/projects/${project.id}/versions/${id}`, { payload: { label } });
  const label = async () => (await as(cookie, 'GET', `/api/projects/${project.id}/versions`)).json()[0].label;

  assert.equal((await rename('Sent to co-authors')).statusCode, 200);
  assert.equal(await label(), 'Sent to co-authors');
  await rename('  ');
  assert.equal(await label(), null);
  assert.equal((await rename('x'.repeat(201))).statusCode, 400);
  const missing = await as(cookie, 'PATCH', `/api/projects/${project.id}/versions/nosuchversion`, { payload: { label: 'x' } });
  assert.equal(missing.statusCode, 404);
});

test('the main file must be a .tex file that is in the project', async () => {
  const { cookie } = await signup(app, 'mainfile@example.com');
  const project = await createProject(app, cookie, 'Main file');
  await app.inject({
    method: 'PUT',
    url: `/api/projects/${project.id}/files/chapters/thesis.tex`,
    headers: { cookie, 'content-type': 'text/plain' },
    payload: '\\documentclass{article}\\begin{document}x\\end{document}',
  });
  const set = (mainFile) => as(cookie, 'PATCH', `/api/projects/${project.id}`, { payload: { mainFile } });
  assert.equal((await set('chapters/thesis.tex')).json().mainFile, 'chapters/thesis.tex');
  assert.equal((await set('missing.tex')).statusCode, 400);
  assert.equal((await set('../outside.tex')).statusCode, 400);
});
