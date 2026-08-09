import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, '..', '..');

// Configurable so the operator can point storage at any disk/mount instead
// of leaving every project buried inside the app's own install directory.
export const DATA_DIR = process.env.QUIRELOOP_DATA_DIR
  ? path.resolve(process.env.QUIRELOOP_DATA_DIR)
  : path.join(ROOT_DIR, 'data');

export const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
export const USERS_FILE = path.join(DATA_DIR, 'users.json');
export const INVITES_FILE = path.join(DATA_DIR, 'invites.json');
export const SESSION_KEY_FILE = path.join(DATA_DIR, 'session-key');
export const PROJECTS_INDEX_FILE = path.join(DATA_DIR, 'projects-index.json');
export const SHARED_INDEX_FILE = path.join(DATA_DIR, 'shared-index.json');
export const SHARE_LINKS_FILE = path.join(DATA_DIR, 'share-links.json');
export const PUBLIC_DIR = path.join(__dirname, '..', 'public');
export const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;
export const HOST = '0.0.0.0';

// Each member gets their own home directory on the host as a browsable root,
// so opening a paper that already lives at /home/arjun/Thesis/paper needs
// no configuration at all. Which directory that is, is resolved per user in
// lib/library.js; this is only where the convention "<base>/<username>" starts
// looking. macOS puts home directories somewhere else, hence the default.
export const USER_HOME_BASE = process.env.QUIRELOOP_USER_HOME_BASE
  ? path.resolve(process.env.QUIRELOOP_USER_HOME_BASE)
  : process.platform === 'darwin'
    ? '/Users'
    : '/home';

// Additional *shared* host directories, on top of each member's own home —
// colon-separated, for a lab drive or a common templates folder. Unlike the
// per-user home, a plain root here is browsable and writable by every member
// with an account, so keep it narrow; the {userId} / {user} / {email}
// placeholders expand per request if you want one entry to mean a different
// directory for each of them.
//
// A root may be written as "Label=/path".
export const LIBRARY_DIRS = (process.env.QUIRELOOP_LIBRARY_DIRS || '')
  .split(':')
  .map((spec) => spec.trim())
  .filter(Boolean)
  .map((spec) => {
    const eq = spec.indexOf('=');
    const label = eq === -1 ? '' : spec.slice(0, eq).trim();
    const dir = eq === -1 ? spec : spec.slice(eq + 1).trim();
    return { label: label || path.basename(dir) || dir, dir };
  })
  .filter((root) => root.dir);

// Mount everything (API, WebSocket, static assets) under this prefix when
// deployed behind a reverse proxy at a subpath instead of the domain root,
// e.g. "/quireloop". Empty string mounts at root, the default.
export const BASE_PATH = (process.env.QUIRELOOP_BASE_PATH || '').replace(/\/$/, '');
