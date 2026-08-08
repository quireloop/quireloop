import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { readJson, updateJson } from './jsonStore.js';

// Server-wide settings the admin edits from the UI (currently: the AI
// assistant's API key and model). Same plain-JSON-file pattern as
// users.json/invites.json — no database, ever.
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

export async function getSettings() {
  return readJson(SETTINGS_FILE, {});
}

export async function updateSettings(patch) {
  // The file can hold the API key — keep it owner-only, like the git
  // credentials files.
  return updateJson(
    SETTINGS_FILE,
    {},
    (current) => {
      const settings = { ...current, ...patch };
      // Deleting a setting = setting it to null/'' from the UI.
      for (const [k, v] of Object.entries(settings)) {
        if (v === null || v === '') delete settings[k];
      }
      return settings;
    },
    { mode: 0o600 }
  );
}
