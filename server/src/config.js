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
export const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');
export const SYNC_CONNECTION_FILE = path.join(DATA_DIR, 'sync-connection.json');
export const COMPILE_CACHE_DIR = path.join(DATA_DIR, 'compile-cache');
export const PUBLIC_DIR = path.join(__dirname, '..', 'public');
export const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;
export const HOST = '0.0.0.0';

// How compiles are isolated (lib/compileSandbox.js). "auto" uses bubblewrap
// where it can run, which suits a laptop; a shared server should say "required"
// so that losing bubblewrap stops compiles rather than exposing every project.
const SANDBOX_MODES = ['auto', 'required', 'off'];
export const COMPILE_SANDBOX_MODE = SANDBOX_MODES.includes(process.env.QUIRELOOP_COMPILE_SANDBOX)
  ? process.env.QUIRELOOP_COMPILE_SANDBOX
  : 'auto';

// Extra read-only folders for a TeX install outside /usr, colon-separated.
export const COMPILE_SANDBOX_PATHS = (process.env.QUIRELOOP_COMPILE_SANDBOX_PATHS || '')
  .split(':')
  .filter(Boolean);

// Log in with the host's own UNIX accounts instead of Quireloop-managed ones.
// Unset disables it entirely and only email/password login exists.
//
// Authentication runs in deploy/quireloop-pam-auth, a separate process the
// operator installs as root, because a PAM stack with pam_google_authenticator
// must read each user's ~/.google_authenticator (mode 0600, owned by them) —
// which this server, running unprivileged, cannot and should not be able to do.
export const PAM_ENABLED = process.env.QUIRELOOP_PAM_ENABLED === 'true';

// How to invoke that helper. The default runs it through sudo under the one
// narrowly scoped rule in deploy/quireloop-sudoers.example. Overridable as a
// whole so a deployment can use a socket-activated helper instead — and so the
// tests can point at a fake one, since PAM can't be exercised in a test suite.
export const PAM_HELPER_COMMAND = process.env.QUIRELOOP_PAM_HELPER
  ? process.env.QUIRELOOP_PAM_HELPER.split(' ').filter(Boolean)
  : ['sudo', '-n', '/usr/local/libexec/quireloop-pam-auth'];

// Synthesized for PAM accounts, which have a username but no email address.
// Sharing and collaborator lists are keyed on email in the UI, so every account
// needs one that is stable and unique.
export const PAM_EMAIL_DOMAIN = process.env.QUIRELOOP_PAM_EMAIL_DOMAIN || 'localhost';

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
