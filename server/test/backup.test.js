import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(import.meta.dirname, '../../scripts/quireloop-backup.sh');

// The backup job runs only on the Linux server (systemd timer) and leans on
// GNU tools and bash 4, which macOS and Windows don't ship.
const skip = process.platform !== 'linux' && 'the backup script is for the Linux server';

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ql-backup-'));
  const data = path.join(root, 'data');
  const dest = path.join(root, 'backup');
  await fs.mkdir(path.join(data, 'projects/u/p'), { recursive: true });
  await fs.mkdir(path.join(data, 'compile-cache'));
  await fs.mkdir(dest);
  await fs.writeFile(path.join(data, 'users.json'), '[]');
  await fs.writeFile(path.join(data, 'compile-cache/big'), 'x');
  await fs.writeFile(path.join(data, 'projects/u/p/main.tex'), 'hello');
  return { root, data, dest };
}

function run(env) {
  return spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, QUIRELOOP_BACKUP_CONFIG: '/nonexistent', ...env },
  });
}

test('makes a restorable copy, leaves out the compile cache, and reports it', { skip }, async () => {
  const { data, dest } = await setup();
  const result = run({ QUIRELOOP_DATA_DIR: data, BACKUP_DIR: dest, ALLOW_SAME_DISK: '1' });
  assert.equal(result.status, 0, result.stderr);
  const [day] = (await fs.readdir(dest)).filter((n) => /^20/.test(n));
  assert.equal(await fs.readFile(path.join(dest, day, 'projects/u/p/main.tex'), 'utf8'), 'hello');
  await assert.rejects(fs.stat(path.join(dest, day, 'compile-cache')));
  const mode = (await fs.stat(path.join(dest, day))).mode & 0o777;
  assert.equal(mode, 0o700);
  const status = JSON.parse(await fs.readFile(path.join(data, 'backup-status.json'), 'utf8'));
  assert.equal(status.snapshots, 1);
  assert.equal(status.verified, true);
});

test('a project opened from a folder elsewhere is copied, not just its link', { skip }, async () => {
  const { root, data, dest } = await setup();
  const elsewhere = path.join(root, 'home/paper');
  await fs.mkdir(elsewhere, { recursive: true });
  await fs.writeFile(path.join(elsewhere, 'main.tex'), 'in place');
  await fs.symlink(elsewhere, path.join(data, 'projects/u/linked'));
  for (let i = 0; i < 2; i += 1) {
    const result = run({ QUIRELOOP_DATA_DIR: data, BACKUP_DIR: dest, ALLOW_SAME_DISK: '1' });
    assert.equal(result.status, 0, result.stderr);
  }
  const [day] = (await fs.readdir(dest)).filter((n) => /^20/.test(n));
  const copied = path.join(dest, day, 'projects/u/linked');
  assert.ok((await fs.lstat(copied)).isDirectory());
  assert.equal(await fs.readFile(path.join(copied, 'main.tex'), 'utf8'), 'in place');
});

test('refuses a target on the same disk', { skip }, async () => {
  const { data, dest } = await setup();
  const result = run({ QUIRELOOP_DATA_DIR: data, BACKUP_DIR: dest });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /same disk/);
});

test('refuses a missing target rather than creating it', { skip }, async () => {
  const { data, root } = await setup();
  const result = run({ QUIRELOOP_DATA_DIR: data, BACKUP_DIR: path.join(root, 'nope'), ALLOW_SAME_DISK: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /mounted/);
});

test('shares unchanged files with the last copy and drops old copies', { skip }, async () => {
  const { data, dest } = await setup();
  const old = ['2020-01-05', '2020-01-20', '2020-02-03', '2020-02-10'];
  for (const day of old) {
    await fs.mkdir(path.join(dest, day, 'projects/u/p'), { recursive: true });
    await fs.writeFile(path.join(dest, day, 'projects/u/p/main.tex'), 'hello');
  }
  const result = run({ QUIRELOOP_DATA_DIR: data, BACKUP_DIR: dest, ALLOW_SAME_DISK: '1', KEEP_DAILY: '2', KEEP_MONTHLY: '2' });
  assert.equal(result.status, 0, result.stderr);
  const days = (await fs.readdir(dest)).filter((n) => /^20/.test(n)).sort();
  // Today, the newest old copy, and the first copy of each of the last 2 months.
  assert.equal(days.length, 3, days.join());
  assert.ok(days.includes('2020-02-10'));
  assert.ok(days.includes('2020-02-03'));
  const today = days[days.length - 1];
  const [a, b] = await Promise.all(
    ['2020-02-10', today].map((d) => fs.stat(path.join(dest, d, 'projects/u/p/main.tex')))
  );
  assert.equal(a.ino, b.ino);
});

test('every run makes its own copy, and recent copies are all kept', { skip }, async () => {
  const { data, dest } = await setup();
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const name = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  const recent = [new Date(now - 20 * 60e3), new Date(now - 10 * 60e3)].map(name);
  for (const copy of ['2020-03-01_0900', ...recent]) {
    await fs.mkdir(path.join(dest, copy, 'projects/u/p'), { recursive: true });
    await fs.writeFile(path.join(dest, copy, 'projects/u/p/main.tex'), 'hello');
  }
  const result = run({ QUIRELOOP_DATA_DIR: data, BACKUP_DIR: dest, ALLOW_SAME_DISK: '1', KEEP_DAILY: '0', KEEP_MONTHLY: '0' });
  assert.equal(result.status, 0, result.stderr);
  const copies = (await fs.readdir(dest)).filter((n) => /^20/.test(n)).sort();
  // Nothing changed, yet this run made a copy of its own beside the recent ones.
  assert.equal(copies.length, 3, copies.join());
  for (const copy of recent) assert.ok(copies.includes(copy), copies.join());
  assert.match(copies[2], /^\d{4}-\d\d-\d\d_\d{4}$/);
  const status = JSON.parse(await fs.readFile(path.join(data, 'backup-status.json'), 'utf8'));
  assert.equal(status.snapshots, 3);
});

test('older days keep only their last copy', { skip }, async () => {
  const { data, dest } = await setup();
  const old = ['2020-03-01_0900', '2020-03-01_1800', '2020-03-02_0900', '2020-03-02_0910'];
  for (const copy of old) {
    await fs.mkdir(path.join(dest, copy, 'projects/u/p'), { recursive: true });
    await fs.writeFile(path.join(dest, copy, 'projects/u/p/main.tex'), 'hello');
  }
  // Days, newest first: today, 2020-03-02, 2020-03-01.
  const result = run({ QUIRELOOP_DATA_DIR: data, BACKUP_DIR: dest, ALLOW_SAME_DISK: '1', KEEP_DAILY: '3', KEEP_MONTHLY: '0' });
  assert.equal(result.status, 0, result.stderr);
  const copies = (await fs.readdir(dest)).filter((n) => n.startsWith('2020')).sort();
  assert.deepEqual(copies, ['2020-03-01_1800', '2020-03-02_0910']);
});
