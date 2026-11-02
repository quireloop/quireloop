import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import { DEVICES_FILE } from '../config.js';
import { readJson, updateJson, updateJsonWithResult } from './jsonStore.js';

const MODE = { mode: 0o600 };
const PAIRING_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 50;
const NAME_LIMIT = 60;
// No 0/O or 1/I, because a person reads this code off one screen.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Linking a computer: the computer asks for a code, its owner approves that
// code in a browser where they're already signed in, and the computer collects
// its token. The password and two-factor code are only ever typed into the
// server's own page, never into the laptop.
const pairings = new Map(); // deviceCode -> { userCode, deviceName, expiresAt, userId }

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function randomUserCode() {
  const pick = () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  const part = () => Array.from({ length: 4 }, pick).join('');
  return `${part()}-${part()}`;
}

function dropExpired() {
  const now = Date.now();
  for (const [code, pairing] of pairings) {
    if (pairing.expiresAt <= now) pairings.delete(code);
  }
}

export function startPairing(deviceName) {
  dropExpired();
  if (pairings.size >= MAX_PENDING) throw new Error('too many requests, try again in a few minutes');
  const deviceCode = crypto.randomBytes(32).toString('base64url');
  const userCode = randomUserCode();
  pairings.set(deviceCode, {
    userCode,
    deviceName: String(deviceName || 'Unnamed computer').slice(0, NAME_LIMIT),
    expiresAt: Date.now() + PAIRING_TTL_MS,
    userId: null,
  });
  return { deviceCode, userCode, expiresInSeconds: PAIRING_TTL_MS / 1000 };
}

function findPairing(userCode) {
  dropExpired();
  for (const pairing of pairings.values()) {
    if (pairing.userCode === userCode && !pairing.userId) return pairing;
  }
  return null;
}

export function describePairing(userCode) {
  const pairing = findPairing(userCode);
  return pairing ? { deviceName: pairing.deviceName } : null;
}

export function approvePairing(userCode, userId) {
  const pairing = findPairing(userCode);
  if (!pairing) return false;
  pairing.userId = userId;
  return true;
}

// Returns null while waiting. The token exists only in this one reply; the
// server keeps just its hash.
export async function collectToken(deviceCode) {
  dropExpired();
  const pairing = pairings.get(deviceCode);
  if (!pairing) throw new Error('this link request has expired');
  if (!pairing.userId) return null;
  pairings.delete(deviceCode);

  const token = crypto.randomBytes(32).toString('base64url');
  const device = {
    id: nanoid(10),
    userId: pairing.userId,
    name: pairing.deviceName,
    tokenHash: hashToken(token),
    createdAt: new Date().toISOString(),
    lastSeenAt: null,
  };
  await updateJson(DEVICES_FILE, [], (devices) => [...devices, device], MODE);
  return { token, deviceId: device.id };
}

const SEEN_WRITE_INTERVAL_MS = 5 * 60 * 1000;

export async function findDeviceByToken(token) {
  const hash = hashToken(token);
  const devices = await readJson(DEVICES_FILE, []);
  const device = devices.find((d) => d.tokenHash === hash);
  if (!device) return null;
  // A laptop checks in every few seconds; the file doesn't need to know.
  if (Date.now() - new Date(device.lastSeenAt ?? 0).getTime() > SEEN_WRITE_INTERVAL_MS) {
    const now = new Date().toISOString();
    await updateJson(
      DEVICES_FILE,
      [],
      (all) => all.map((d) => (d.id === device.id ? { ...d, lastSeenAt: now } : d)),
      MODE
    );
  }
  return device;
}

export async function listDevices(userId) {
  const devices = await readJson(DEVICES_FILE, []);
  return devices
    .filter((d) => d.userId === userId)
    .map(({ id, name, createdAt, lastSeenAt }) => ({ id, name, createdAt, lastSeenAt }));
}

export async function revokeDevice(userId, deviceId) {
  return updateJsonWithResult(
    DEVICES_FILE,
    [],
    (devices) => {
      const kept = devices.filter((d) => !(d.id === deviceId && d.userId === userId));
      return { value: kept, result: kept.length !== devices.length };
    },
    MODE
  );
}
