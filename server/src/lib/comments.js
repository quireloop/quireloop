import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { projectDir } from './storage.js';

const MAX_TEXT_LENGTH = 5000;

function commentsPath(ownerId, projectId) {
  return path.join(projectDir(ownerId, projectId), '.quireloop-comments.json');
}

async function readThreads(ownerId, projectId) {
  try {
    return JSON.parse(await fs.readFile(commentsPath(ownerId, projectId), 'utf8'));
  } catch {
    return [];
  }
}

async function writeThreads(ownerId, projectId, threads) {
  await fs.writeFile(commentsPath(ownerId, projectId), JSON.stringify(threads, null, 2));
}

export function validateCommentText(text) {
  return typeof text === 'string' && text.trim().length > 0 && text.length <= MAX_TEXT_LENGTH;
}

// filePath === null/undefined returns every thread in the project (used
// when a caller wants everything, e.g. a future "all comments" view).
export async function listThreads(ownerId, projectId, filePath) {
  const threads = await readThreads(ownerId, projectId);
  if (!filePath) return threads;
  return threads.filter((t) => t.filePath === filePath);
}

export async function createThread(ownerId, projectId, { filePath, anchor, text, userId, email }) {
  const threads = await readThreads(ownerId, projectId);
  const now = new Date().toISOString();
  const thread = {
    id: nanoid(10),
    filePath,
    anchor,
    createdBy: userId,
    createdByEmail: email,
    createdAt: now,
    resolved: false,
    messages: [{ id: nanoid(10), userId, email, at: now, text }],
  };
  threads.push(thread);
  await writeThreads(ownerId, projectId, threads);
  return thread;
}

export async function addMessage(ownerId, projectId, threadId, { userId, email, text }) {
  const threads = await readThreads(ownerId, projectId);
  const thread = threads.find((t) => t.id === threadId);
  if (!thread) return null;
  const message = { id: nanoid(10), userId, email, at: new Date().toISOString(), text };
  thread.messages.push(message);
  await writeThreads(ownerId, projectId, threads);
  return thread;
}

export async function setResolved(ownerId, projectId, threadId, resolved) {
  const threads = await readThreads(ownerId, projectId);
  const thread = threads.find((t) => t.id === threadId);
  if (!thread) return null;
  thread.resolved = !!resolved;
  await writeThreads(ownerId, projectId, threads);
  return thread;
}

export async function getThread(ownerId, projectId, threadId) {
  const threads = await readThreads(ownerId, projectId);
  return threads.find((t) => t.id === threadId) ?? null;
}

// Caller must have already checked that the requester is the thread's
// creator or the project owner — this just performs the removal.
export async function deleteThread(ownerId, projectId, threadId) {
  const threads = await readThreads(ownerId, projectId);
  const next = threads.filter((t) => t.id !== threadId);
  if (next.length === threads.length) return false;
  await writeThreads(ownerId, projectId, next);
  return true;
}
