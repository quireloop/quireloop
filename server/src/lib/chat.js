import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { projectDir } from './storage.js';
import { withLock, writeJsonAtomic } from './jsonStore.js';

const MAX_TEXT_LENGTH = 2000;
const MAX_STORED_MESSAGES = 500;
const DEFAULT_PAGE_SIZE = 100;

function chatPath(ownerId, projectId) {
  return path.join(projectDir(ownerId, projectId), '.quireloop-chat.json');
}

async function readMessages(ownerId, projectId) {
  try {
    return JSON.parse(await fs.readFile(chatPath(ownerId, projectId), 'utf8'));
  } catch {
    return [];
  }
}

async function writeMessages(ownerId, projectId, messages) {
  const capped = messages.slice(-MAX_STORED_MESSAGES);
  await writeJsonAtomic(chatPath(ownerId, projectId), capped);
}

export function validateChatText(text) {
  return typeof text === 'string' && text.trim().length > 0 && text.length <= MAX_TEXT_LENGTH;
}

// `after` is a message id — returns everything strictly newer than it.
// With no `after`, returns just the tail (most recent DEFAULT_PAGE_SIZE).
export async function listMessages(ownerId, projectId, after) {
  const messages = await readMessages(ownerId, projectId);
  if (!after) return messages.slice(-DEFAULT_PAGE_SIZE);
  const idx = messages.findIndex((m) => m.id === after);
  if (idx === -1) return messages.slice(-DEFAULT_PAGE_SIZE);
  return messages.slice(idx + 1);
}

export async function addMessage(ownerId, projectId, { userId, email, text }) {
  // Read-modify-write of one shared JSON file: collaborators hitting this
  // at the same moment would otherwise each write a list built from the
  // same stale read, silently dropping all but the last change.
  return withLock(chatPath(ownerId, projectId), async () => {
    const messages = await readMessages(ownerId, projectId);
    const message = { id: nanoid(10), userId, email, text, at: new Date().toISOString() };
    messages.push(message);
    await writeMessages(ownerId, projectId, messages);
    return message;
  });
}
