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

export async function findUserByUnixUser(username) {
  const users = await readUsers();
  return users.find((u) => u.authProvider === 'pam' && u.unixUser === username) ?? null;
}

// Turns a UNIX account that PAM has just vouched for into a Quireloop user
// record, creating it on first login. `account` is what lib/pam.js returned.
//
// The record keeps an opaque nanoid `id` like any other, rather than using the
// UNIX username as the identity. That id is a directory name under
// data/projects/, the key of shared-index.json, and the value compared in every
// manifest's ownerId and collaborators[].userId — so making it mean something
// new would require rewriting all of that. Keeping it opaque means PAM login
// costs no migration at all, and an account can even be renamed on the host
// without Quireloop noticing.
export async function upsertPamUser(account, { emailDomain }) {
  return updateJsonWithResult(
    USERS_FILE,
    [],
    (users) => {
      const existing = users.find((u) => u.authProvider === 'pam' && u.unixUser === account.username);

      // The home directory and uid are re-read from the host on every login
      // rather than trusted from the record: an admin may have moved the home
      // directory since, and a stale path here would send the file browser
      // somewhere that no longer belongs to this person.
      const unix = {
        unixUser: account.username,
        unixUid: account.uid,
        unixGid: account.gid,
        unixHome: account.home,
      };

      if (existing) {
        const updated = { ...existing, ...unix };
        return {
          value: users.map((u) => (u.id === existing.id ? updated : u)),
          result: updated,
        };
      }

      const user = {
        id: nanoid(10),
        // PAM accounts have a username, not an address, but sharing and
        // collaborator lists are keyed on email throughout the UI.
        email: `${account.username}@${emailDomain}`,
        authProvider: 'pam',
        ...unix,
        fullName: account.fullName || '',
        // No password and no TOTP secret are ever stored for these: both live
        // on the host, which is the entire point.
        passwordHash: null,
        twoFactorEnabled: false,
        twoFactorSecret: null,
        pendingTwoFactorSecret: null,
        role: users.length === 0 ? 'admin' : 'member',
        disabled: false,
        createdAt: new Date().toISOString(),
        assistant: { provider: null },
      };
      return { value: [...users, user], result: user };
    },
    USERS_MODE
  );
}

export function isPamUser(user) {
  return user?.authProvider === 'pam';
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
  return {
    id: user.id,
    email: user.email,
    twoFactorEnabled: user.twoFactorEnabled,
    role: user.role,
    // The UI hides password and 2FA settings for these — both are managed on
    // the host, not here — and shows the account name instead of the
    // synthesized email address.
    authProvider: user.authProvider ?? 'local',
    ...(user.unixUser ? { unixUser: user.unixUser } : {}),
  };
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
    openaiKeySet: Boolean(a.openaiApiKey),
    openaiKeyMasked: maskKey(a.openaiApiKey),
    openaiModel: a.openaiModel || '',
    geminiKeySet: Boolean(a.geminiApiKey),
    geminiKeyMasked: maskKey(a.geminiApiKey),
    geminiModel: a.geminiModel || '',
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
