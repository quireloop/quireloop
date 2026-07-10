import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, '..', '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
export const PUBLIC_DIR = path.join(__dirname, '..', 'public');
export const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;
export const HOST = '0.0.0.0';
