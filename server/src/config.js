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
export const SESSION_KEY_FILE = path.join(DATA_DIR, 'session-key');
export const PROJECTS_INDEX_FILE = path.join(DATA_DIR, 'projects-index.json');
export const SHARED_INDEX_FILE = path.join(DATA_DIR, 'shared-index.json');
export const PUBLIC_DIR = path.join(__dirname, '..', 'public');
export const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;
export const HOST = '0.0.0.0';
