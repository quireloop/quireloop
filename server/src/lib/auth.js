import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import { USERS_FILE, SESSION_KEY_FILE } from '../config.js';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

async function readUsers() {
  try {
    return JSON.parse(await fs.readFile(USERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function writeUsers(users) {
  await fs.mkdir(USERS_FILE.replace(/\/[^/]+$/, ''), { recursive: true });
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

export async function usersExist() {
  return (await readUsers()).length > 0;
}

export async function findUserByEmail(email) {
  const users = await readUsers();
  return users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
}

export async function findUserById(id) {
  const users = await readUsers();
  return users.find((u) => u.id === id) ?? null;
}

export async function createUser(email, password) {
  const users = await readUsers();
  if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    throw new Error('an account with that email already exists');
  }
  const user = {
    id: nanoid(10),
    email,
    passwordHash: hashPassword(password),
    twoFactorEnabled: false,
    twoFactorSecret: null,
    pendingTwoFactorSecret: null,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  await writeUsers(users);
  return user;
}

export async function updateUser(id, patch) {
  const users = await readUsers();
  const user = users.find((u) => u.id === id);
  if (!user) throw new Error('user not found');
  Object.assign(user, patch);
  await writeUsers(users);
  return user;
}

// Strips the password hash and 2FA secrets before a user record ever goes
// into an HTTP response.
export function publicUser(user) {
  return { id: user.id, email: user.email, twoFactorEnabled: user.twoFactorEnabled };
}

// Bridges "password verified" to "2FA code verified" during login without
// a server-side session store — a short-lived HMAC-signed token carrying
// just the user id, good enough for the few seconds between the two steps.
const TEMP_TOKEN_SECRET = crypto.randomBytes(32);
const TEMP_TOKEN_TTL_MS = 5 * 60 * 1000;

export function signTempToken(userId) {
  const payload = JSON.stringify({ userId, exp: Date.now() + TEMP_TOKEN_TTL_MS });
  const encoded = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', TEMP_TOKEN_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyTempToken(token) {
  try {
    const [encoded, sig] = token.split('.');
    const expectedSig = crypto.createHmac('sha256', TEMP_TOKEN_SECRET).update(encoded).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
    const { userId, exp } = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    if (Date.now() > exp) return null;
    return userId;
  } catch {
    return null;
  }
}

export async function loadOrCreateSessionKey() {
  try {
    return await fs.readFile(SESSION_KEY_FILE);
  } catch {
    const key = crypto.randomBytes(32);
    await fs.mkdir(SESSION_KEY_FILE.replace(/\/[^/]+$/, ''), { recursive: true });
    await fs.writeFile(SESSION_KEY_FILE, key);
    return key;
  }
}
