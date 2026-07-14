import fs from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { INVITES_FILE } from '../config.js';

async function readInvites() {
  try {
    return JSON.parse(await fs.readFile(INVITES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function writeInvites(invites) {
  await fs.mkdir(INVITES_FILE.replace(/\/[^/]+$/, ''), { recursive: true });
  await fs.writeFile(INVITES_FILE, JSON.stringify(invites, null, 2));
}

export async function createInvite(adminId) {
  const invites = await readInvites();
  const invite = {
    code: nanoid(12),
    createdBy: adminId,
    createdAt: new Date().toISOString(),
    usedBy: null,
    usedAt: null,
  };
  invites.push(invite);
  await writeInvites(invites);
  return invite;
}

export async function listInvites() {
  return readInvites();
}

export async function isInviteValid(code) {
  const invites = await readInvites();
  const invite = invites.find((i) => i.code === code);
  return Boolean(invite && !invite.usedBy);
}

// Check-and-mark in one read/write cycle so two concurrent signups can't
// both succeed off the same single-use code.
export async function consumeInvite(code, userId) {
  const invites = await readInvites();
  const invite = invites.find((i) => i.code === code);
  if (!invite || invite.usedBy) return false;
  invite.usedBy = userId;
  invite.usedAt = new Date().toISOString();
  await writeInvites(invites);
  return true;
}

export async function revokeInvite(code) {
  const invites = await readInvites();
  const remaining = invites.filter((i) => i.code !== code || i.usedBy);
  if (remaining.length === invites.length) return false;
  await writeInvites(remaining);
  return true;
}
