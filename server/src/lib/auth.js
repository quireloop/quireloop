import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { nanoid } from 'nanoid';
import { USERS_FILE, SESSION_KEY_FILE } from '../config.js';
import { readJson, updateJson, updateJsonWithResult } from './jsonStore.js';

const USERS_MODE = { mode: 0o600 };

// scrypt is deliberately slow (~100ms), which is the point for password
// storage — but the *Sync* variants block the event loop for that whole
// time, freezing every other request in the process. On a shared lab server
// a handful of simultaneous logins would stall everyone's editing and
// compiles. The async form does the same work on the threadpool.
const scrypt = promisify(crypto.scrypt);

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  return `${salt}:${hash}`;
}

export async function verifyPassword(password, stored) {
  const [salt, hash] = (stored ?? '').split(':');
  if (!salt || !hash) return false;
  const candidate = await scrypt(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

async function readUsers() {
  return readJson(USERS_FILE, []);
}

export async function usersExist() {
  return (await readUsers()).length > 0;
}

export async function listUsers() {
  return readUsers();
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
  // Hash before taking the lock — scrypt is the slow part, and holding the
  // users-file lock across it would serialize every concurrent signup behind
  // ~100ms of key derivation each.
  const passwordHash = await hashPassword(password);

  // The duplicate-email check and the append have to happen under one lock:
  // separately, two simultaneous signups for the same address would both see
  // no conflict, and the second write would also drop the first user entirely.
  return updateJsonWithResult(
    USERS_FILE,
    [],
    (users) => {
      if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
        throw new Error('an account with that email already exists');
      }
      const user = {
        id: nanoid(10),
        email,
        passwordHash,
        twoFactorEnabled: false,
        twoFactorSecret: null,
        pendingTwoFactorSecret: null,
        // The very first account on a fresh deployment is the admin; everyone
        // else signs up as a plain member (via invite, unless open signup).
        role: users.length === 0 ? 'admin' : 'member',
        disabled: false,
        createdAt: new Date().toISOString(),
        // Each member's own AI assistant provider — never a shared account.
        assistant: { provider: null },
      };
      return { value: [...users, user], result: user };
    },
    USERS_MODE
  );
}

export async function updateUser(id, patch) {
  return updateJsonWithResult(
    USERS_FILE,
    [],
    (users) => {
      const user = users.find((u) => u.id === id);
      if (!user) throw new Error('user not found');
      const updated = { ...user, ...patch };
      return {
        value: users.map((u) => (u.id === id ? updated : u)),
        result: updated,
      };
    },
    USERS_MODE
  );
}

export async function deleteUser(id) {
  await updateJson(USERS_FILE, [], (users) => users.filter((u) => u.id !== id), USERS_MODE);
}

// Deployments that predate the role field have users.json with no `role`
// key at all. Run once at startup: earliest-created user becomes admin,
// everyone else member. No-op once every user already has a role.
export async function migrateUserRoles() {
  await updateJson(
    USERS_FILE,
    [],
    (users) => {
      if (users.length === 0 || users.every((u) => u.role)) return undefined; // no-op
      const byCreatedAt = [...users].sort(
        (a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0)
      );
      const earliestId = byCreatedAt[0].id;
      return users.map((u) => ({
        ...u,
        role: u.role ?? (u.id === earliestId ? 'admin' : 'member'),
        disabled: u.disabled === undefined ? false : u.disabled,
      }));
    },
    USERS_MODE
  );
}

// Strips the password hash and 2FA secrets before a user record ever goes
// into an HTTP response.
export function publicUser(user) {
  return { id: user.id, email: user.email, twoFactorEnabled: user.twoFactorEnabled, role: user.role };
}

function maskKey(key) {
  if (!key || key.length < 12) return key ? '***' : '';
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

// Masked view of a user's own assistant provider config — never returns
// the raw Anthropic key, mirrors admin.js's maskKey() convention.
export function maskedAssistantSettings(user) {
  const a = user.assistant || { provider: null };
  return {
    provider: a.provider || null,
    anthropicKeySet: Boolean(a.anthropicApiKey),
    anthropicKeyMasked: maskKey(a.anthropicApiKey),
    anthropicModel: a.anthropicModel || 'claude-opus-4-8',
    ollamaBaseUrl: a.ollamaBaseUrl || '',
    ollamaModel: a.ollamaModel || '',
  };
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
    await fs.writeFile(SESSION_KEY_FILE, key, { mode: 0o600 });
    return key;
  }
}
