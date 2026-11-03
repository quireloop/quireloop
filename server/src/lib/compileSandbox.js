import { createHash } from 'node:crypto';
import { execa } from 'execa';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { COMPILE_CACHE_DIR, COMPILE_SANDBOX_MODE, COMPILE_SANDBOX_PATHS } from '../config.js';

// Limits for one compile, applied in every mode. Memory is address space, so
// it sits well above what a large paper really uses; the wall-clock limit is
// the timeout in lib/latex.js.
const LIMITS = ['--as=6442450944', '--fsize=2147483648', '--cpu=180', '--core=0'];

// What a compile needs from the host, read-only. Nothing under /home, the data
// directory or the rest of /etc is visible, and a path missing here is skipped.
const SYSTEM_PATHS = [
  '/usr',
  '/etc/texmf',
  '/etc/fonts',
  '/etc/alternatives',
  '/etc/ld.so.cache',
  '/var/lib/texmf',
  '/var/cache/fontconfig',
  ...COMPILE_SANDBOX_PATHS,
];
const USR_MERGED_LINKS = ['bin', 'sbin', 'lib', 'lib32', 'lib64'];

// The environment is built from nothing: the server's own holds the assistant
// API key, and LuaTeX can read any variable it is given.
const CLEAN_ENV_NAMES = ['PATH', 'LANG', 'LC_ALL', 'TEXMFHOME', 'TEXINPUTS', 'BIBINPUTS', 'BSTINPUTS'];
// Windows programs, latexmk's Perl among them, fail without the system ones,
// and MiKTeX keeps its settings under the profile folders. None hold secrets.
const WINDOWS_ENV_NAMES = [
  'SystemRoot', 'windir', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP',
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles',
];

function cleanEnv() {
  const env = { openin_any: 'p', openout_any: 'p' };
  const names = process.platform === 'win32' ? [...CLEAN_ENV_NAMES, ...WINDOWS_ENV_NAMES] : CLEAN_ENV_NAMES;
  for (const name of names) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return env;
}

async function exists(target) {
  return fs.access(target).then(() => true).catch(() => false);
}

let probe;

// Ubuntu 24.04 ships bubblewrap unable to start until it has the AppArmor
// profile in deploy/, so being installed isn't enough: it has to actually run.
export function sandboxAvailable() {
  probe ??= execa('bwrap', ['--ro-bind', '/', '/', '--unshare-net', '--unshare-pid', 'true'], {
    reject: false,
    timeout: 10_000,
  })
    .then((result) => result.exitCode === 0)
    .catch(() => false);
  return probe;
}

// Reported at startup, and refused at compile time in "required" mode, so a
// server that expects isolation fails closed instead of quietly losing it.
export async function sandboxStatus() {
  if (COMPILE_SANDBOX_MODE === 'off') return 'off';
  return (await sandboxAvailable()) ? 'on' : 'unavailable';
}

async function bubblewrapArgs(cwd, cacheDir) {
  const args = ['--unshare-all', '--die-with-parent', '--new-session', '--clearenv', '--cap-drop', 'ALL'];
  for (const link of USR_MERGED_LINKS) {
    if (await exists(`/usr/${link}`)) args.push('--symlink', `usr/${link}`, `/${link}`);
  }
  for (const source of SYSTEM_PATHS) {
    if (await exists(source)) args.push('--ro-bind', source, source);
  }
  args.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp');
  // The project is read-only so a paper can't change its source or, worse,
  // plant a hook in .git that the server would later run outside this box.
  args.push('--ro-bind', cwd, cwd, '--bind', path.join(cwd, 'build'), path.join(cwd, 'build'));
  // Font caches take a long time to build, so they outlive the compile. One
  // per project, because LuaTeX executes them and a paper can write to them.
  args.push('--bind', cacheDir, '/cache', '--chdir', cwd);
  return args;
}

// Everything a compile leaves behind is written by untrusted code. A symlink
// at build/main.pdf would have the PDF route serve whatever it points at with
// the server's own access, so none survive the sandbox.
export async function removeSymlinks(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) await fs.rm(target, { force: true });
    else if (entry.isDirectory()) await removeSymlinks(target);
  }
}

async function prepareBuildDir(cwd) {
  const build = path.join(cwd, 'build');
  const stat = await fs.lstat(build).catch(() => null);
  if (stat?.isSymbolicLink()) await fs.rm(build);
  await fs.mkdir(build, { recursive: true });
  return build;
}

// Returns how to run `argv` in `cwd`: the command, its arguments and its
// options for execa. `after` must run once the command has finished.
export async function sandboxCommand(projectPath, argv) {
  // A project opened in place is a symlink to the real folder. Mounting at the
  // real path keeps SyncTeX's recorded paths matching what lib/synctex.js expects.
  const cwd = await fs.realpath(projectPath);
  const useSandbox = COMPILE_SANDBOX_MODE !== 'off' && (await sandboxAvailable());
  if (!useSandbox && COMPILE_SANDBOX_MODE === 'required') {
    throw new Error('Compiling is switched off: the compile sandbox is required but bubblewrap cannot run on this server.');
  }

  const env = cleanEnv();
  const hasPrlimit = process.platform === 'linux' && (await exists('/usr/bin/prlimit'));
  const limit = hasPrlimit ? ['/usr/bin/prlimit', ...LIMITS, '--'] : [];
  const options = { cwd, env, extendEnv: false, killSignal: 'SIGKILL' };

  if (!useSandbox) {
    env.HOME = process.env.HOME ?? os.homedir();
    const [file, ...args] = [...limit, ...argv];
    return { file, args, options, after: async () => {} };
  }

  const build = await prepareBuildDir(cwd);
  const cacheDir = path.join(COMPILE_CACHE_DIR, createHash('sha256').update(cwd).digest('hex'));
  await fs.mkdir(cacheDir, { recursive: true });
  Object.assign(env, { HOME: '/cache', TEXMFVAR: '/cache/texmf-var', TEXMFCONFIG: '/cache/texmf-config' });

  const setenv = Object.entries(env).flatMap(([name, value]) => ['--setenv', name, value]);
  const [file, ...args] = [...limit, 'bwrap', ...(await bubblewrapArgs(cwd, cacheDir)), ...setenv, ...argv];
  return { file, args, options, after: () => removeSymlinks(build) };
}
