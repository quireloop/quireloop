import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { projectDir } from './storage.js';

const VALID_TYPES = new Set(['insert', 'delete']);

function suggestionsPath(ownerId, projectId) {
  return path.join(projectDir(ownerId, projectId), '.quireloop-suggestions.json');
}

async function readSuggestions(ownerId, projectId) {
  try {
    return JSON.parse(await fs.readFile(suggestionsPath(ownerId, projectId), 'utf8'));
  } catch {
    return [];
  }
}

async function writeSuggestions(ownerId, projectId, records) {
  await fs.writeFile(suggestionsPath(ownerId, projectId), JSON.stringify(records, null, 2));
}

export function validateSuggestionType(type) {
  return VALID_TYPES.has(type);
}

// filePath === null/undefined returns every suggestion in the project.
export async function listSuggestions(ownerId, projectId, filePath) {
  const records = await readSuggestions(ownerId, projectId);
  if (!filePath) return records;
  return records.filter((r) => r.filePath === filePath);
}

export async function createSuggestion(ownerId, projectId, { filePath, type, anchor, userId, email }) {
  const records = await readSuggestions(ownerId, projectId);
  const record = {
    id: nanoid(10),
    filePath,
    type,
    anchor,
    createdBy: userId,
    createdByEmail: email,
    createdAt: new Date().toISOString(),
  };
  records.push(record);
  await writeSuggestions(ownerId, projectId, records);
  return record;
}

export async function getSuggestion(ownerId, projectId, suggestionId) {
  const records = await readSuggestions(ownerId, projectId);
  return records.find((r) => r.id === suggestionId) ?? null;
}

// Accept and reject both end in the record being removed — the doc edit
// (or lack of one) happens client-side through the normal collab path, so
// this is just record CRUD, same split of responsibility as comments.
export async function removeSuggestion(ownerId, projectId, suggestionId) {
  const records = await readSuggestions(ownerId, projectId);
  const next = records.filter((r) => r.id !== suggestionId);
  if (next.length === records.length) return false;
  await writeSuggestions(ownerId, projectId, next);
  return true;
}
