import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../config.js';

// Server-wide settings the admin edits from the UI (currently: the AI
// assistant's API key and model). Same plain-JSON-file pattern as
// users.json/invites.json — no database, ever.
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

async function readSettings() {
  try {
    return JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export async function getSettings() {
  return readSettings();
}

export async function updateSettings(patch) {
  const settings = { ...(await readSettings()), ...patch };
  // Deleting a setting = setting it to null/'' from the UI.
  for (const [k, v] of Object.entries(settings)) {
    if (v === null || v === '') delete settings[k];
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  // The file can hold the API key — keep it owner-only, like the git
  // credentials files.
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), { mode: 0o600 });
  return settings;
}
