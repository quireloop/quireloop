import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync.js';
import * as awarenessProtocol from 'y-protocols/awareness.js';
import * as encoding from 'lib0/encoding.js';
import * as decoding from 'lib0/decoding.js';
import { projectDir, resolveUserPath } from './storage.js';
import { updateManifest } from './manifest.js';

// Hand-rolled y-websocket wire protocol — y-websocket v3 ships no
// server-side utilities, only the browser client, so the sync/awareness
// message framing below mirrors the (unpublished-as-a-package) reference
// server implementation: message type 0 = sync step / update, 1 = awareness.
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

const PERSIST_DEBOUNCE_MS = 2000;
// How often a file someone has open is checked for changes made outside
// Quireloop: another editor, a script, an assistant writing the file.
const DISK_CHECK_MS = 1500;
const RECENT_EDITORS_TTL_MS = 10 * 60 * 1000;

// One Y.Doc per (ownerId, projectId, filePath) — the "room" that every
// browser tab editing that file connects into. Content is debounce-
// persisted to the real file on disk so compile/git/download keep working
// exactly as before, just fed by whichever content is most current.
const rooms = new Map();

// 'join' and 'leave' fire for each editor connection, so a laptop's copy can
// open and close its live link to the server (lib/syncClient.js).
export const roomEvents = new EventEmitter();

function roomKey(ownerId, projectId, filePath) {
  return `${ownerId}\u0000${projectId}\u0000${filePath}`;
}

async function loadInitialContent(ownerId, projectId, filePath) {
  try {
    return await fs.readFile(await resolveUserPath(ownerId, projectId, filePath), 'utf8');
  } catch {
    return '';
  }
}

async function statFile(room) {
  try {
    const stat = await fs.stat(await resolveUserPath(room.ownerId, room.projectId, room.filePath));
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return null;
  }
}

// Records that the file on disk holds `text`, and that the doc's current state
// is the one that text came from: the common ancestor for the next merge.
function markInSync(room, text, stat) {
  room.disk = { text, mtimeMs: stat?.mtimeMs ?? null, size: stat?.size ?? null };
  room.baseState = Y.encodeStateAsUpdate(room.doc);
}

// Brings in a change made to the file outside Quireloop. A room stays loaded
// after its editors leave, and without this its text, older than the file,
// was written straight back over the outside edit on the next save.
//
// The outside text is applied to a copy of the doc as it was when it last
// matched the file, then merged in, so edits typed in the browser since then
// are kept alongside it rather than either one replacing the other.
async function checkDisk(room, { settled = false } = {}) {
  const stat = await statFile(room);
  // A missing file is left alone: the next save writes it back, as before.
  if (!stat || !room.disk) return;
  if (stat.mtimeMs === room.disk.mtimeMs && stat.size === room.disk.size) return;
  // While polling, wait until the file stops changing, so a write still in
  // progress isn't read halfway through.
  if (settled) {
    const last = room.pendingStat;
    room.pendingStat = stat;
    if (!last || last.mtimeMs !== stat.mtimeMs || last.size !== stat.size) return;
  }
  room.pendingStat = null;
  const text = await loadInitialContent(room.ownerId, room.projectId, room.filePath);
  if (text === room.disk.text) {
    room.disk = { ...room.disk, ...stat };
    return;
  }
  const fork = new Y.Doc();
  Y.applyUpdate(fork, room.baseState);
  applyTextDiff(fork, text);
  const outside = Y.encodeStateAsUpdate(fork, Y.encodeStateVector(room.doc));
  // The fork now matches the file, so it is the ancestor for the next merge.
  room.disk = { text, ...stat };
  room.baseState = Y.encodeStateAsUpdate(fork);
  fork.destroy();
  Y.applyUpdate(room.doc, outside, 'disk');
}

// Disk checks and saves for one room run one at a time, so a check can't read
// the file while a save is writing it, or merge the same change twice.
function serialize(room, fn) {
  const run = room.diskQueue.then(fn, fn);
  room.diskQueue = run.catch(() => {});
  return run;
}

// The Y.Doc binary is persisted alongside the plain-text file so a room
// keeps its CRDT identity across server restarts. Without this, every
// restart re-seeded a fresh doc from the .tex file with brand-new item
// ids — and any client still holding IndexedDB state from before the
// restart would merge the two docs into duplicated content.
function ydocStatePath(ownerId, projectId, filePath) {
  return path.join(projectDir(ownerId, projectId), '.quireloop-ydoc', `${encodeURIComponent(filePath)}.bin`);
}

async function loadYdocState(ownerId, projectId, filePath) {
  try {
    return await fs.readFile(ydocStatePath(ownerId, projectId, filePath));
  } catch {
    return null;
  }
}

async function persistYdocState(room) {
  const target = ydocStatePath(room.ownerId, room.projectId, room.filePath);
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(Y.encodeStateAsUpdate(room.doc)));
  } catch {
    // same failure modes as the text write — project gone mid-session
  }
}

export async function dropYdocState(ownerId, projectId, filePath) {
  try {
    await fs.rm(ydocStatePath(ownerId, projectId, filePath), { force: true });
  } catch {
    // best-effort
  }
}

function broadcast(room, message, excludeConn) {
  for (const conn of room.conns.keys()) {
    if (conn === excludeConn) continue;
    if (conn.readyState === 1) conn.send(message);
  }
}

// Turns a doc's text into `text` with the smallest single edit, so the doc
// keeps its history and anyone connected sees a normal change.
function applyTextDiff(doc, text) {
  const ytext = doc.getText('content');
  const current = ytext.toString();
  if (current === text) return;
  let start = 0;
  const limit = Math.min(current.length, text.length);
  while (start < limit && current[start] === text[start]) start += 1;
  let end = 0;
  while (
    end < limit - start &&
    current[current.length - 1 - end] === text[text.length - 1 - end]
  ) {
    end += 1;
  }
  doc.transact(() => {
    ytext.delete(start, current.length - start - end);
    ytext.insert(start, text.slice(start, text.length - end));
  });
}

function persistRoom(room) {
  clearTimeout(room.persistTimer);
  room.persistTimer = null;
  return serialize(room, async () => {
    // An outside edit made since the last check is merged in, not overwritten.
    await checkDisk(room);
    const text = room.doc.getText('content').toString();
    try {
      // Rewriting identical text would only bump the file's time, which makes
      // other programs watching it think it changed.
      if (text !== room.disk?.text) {
        await fs.writeFile(await resolveUserPath(room.ownerId, room.projectId, room.filePath), text);
      }
      markInSync(room, text, await statFile(room));
    } catch {
      // file/project gone (deleted, restored, renamed mid-session) — nothing to persist to
    }
    await persistYdocState(room);
  });
}

function schedulePersist(room) {
  clearTimeout(room.persistTimer);
  room.persistTimer = setTimeout(() => persistRoom(room), PERSIST_DEBOUNCE_MS);
}

function createRoom(ownerId, projectId, filePath) {
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);

  const room = {
    ownerId,
    projectId,
    filePath,
    doc,
    awareness,
    conns: new Map(), // ws -> Set<awareness clientID> introduced by that connection
    connMeta: new Map(), // ws -> { userId, email }
    recentEditors: new Map(), // userId -> { email, at }
    persistTimer: null,
    disk: null, // { text, mtimeMs, size } as last read from or written to the file
    baseState: null, // the doc's state when its text last matched the file
    pendingStat: null,
    diskQueue: Promise.resolve(),
    diskTimer: null,
  };

  // Only while someone has the file open: an idle room is checked when it is
  // next used, in getRoom and before every save.
  room.diskTimer = setInterval(() => {
    if (room.conns.size > 0) serialize(room, () => checkDisk(room, { settled: true }));
  }, DISK_CHECK_MS);
  room.diskTimer.unref();

  awareness.on('update', ({ added, updated, removed }, origin) => {
    const changedClients = added.concat(updated, removed);
    if (origin && room.conns.has(origin)) {
      const owned = room.conns.get(origin);
      added.forEach((id) => owned.add(id));
      removed.forEach((id) => owned.delete(id));
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients));
    broadcast(room, encoding.toUint8Array(encoder), origin);
  });

  doc.on('update', (update, origin) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    broadcast(room, encoding.toUint8Array(encoder), origin);

    const meta = origin && room.connMeta.get(origin);
    if (meta) {
      room.recentEditors.set(meta.userId, { email: meta.email, at: Date.now() });
    }

    schedulePersist(room);
  });

  return room;
}

export async function getRoom(ownerId, projectId, filePath) {
  const key = roomKey(ownerId, projectId, filePath);
  let room = rooms.get(key);
  if (!room) {
    room = createRoom(ownerId, projectId, filePath);
    rooms.set(key, room);
    room.ready = loadRoom(room);
    await room.ready;
    return room;
  }
  await room.ready;
  await serialize(room, () => checkDisk(room));
  return room;
}

async function loadRoom(room) {
  const { ownerId, projectId, filePath } = room;
  const initial = await loadInitialContent(ownerId, projectId, filePath);
  const savedState = await loadYdocState(ownerId, projectId, filePath);
  if (savedState) {
    // A file changed outside collab (git pull, zip upload, an editor on the
    // host) is applied on top of the saved doc rather than replacing it. A
    // fresh doc would share no history with copies held elsewhere, and merging
    // those two would duplicate the whole file.
    try {
      Y.applyUpdate(new Y.Doc(), savedState);
      Y.applyUpdate(room.doc, savedState);
      applyTextDiff(room.doc, initial);
      markInSync(room, initial, await statFile(room));
      return;
    } catch {
      await dropYdocState(ownerId, projectId, filePath);
    }
  }
  if (initial) room.doc.getText('content').insert(0, initial);
  markInSync(room, initial, await statFile(room));
}

export function addConnection(room, ws, userId, email, role = 'editor') {
  room.conns.set(ws, new Set());
  room.connMeta.set(ws, { userId, email, role });
  roomEvents.emit('join', room);
}

export function removeConnection(room, ws) {
  const owned = room.conns.get(ws);
  room.conns.delete(ws);
  room.connMeta.delete(ws);
  if (owned) {
    awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(owned), null);
  }
  roomEvents.emit('leave', room);
}

// Viewers can request the doc's state (syncStep1, so they still get the
// initial content and any live edits broadcast to them) but syncStep2/
// update submessages carry actual mutations — dropped here rather than in
// the API layer, since the API's write checks alone don't stop a viewer
// from opening the websocket directly and pushing a Yjs update.
export function handleMessage(room, ws, data) {
  const message = data instanceof Uint8Array ? data : new Uint8Array(data);
  const decoder = decoding.createDecoder(message);
  const messageType = decoding.readVarUint(decoder);
  const role = room.connMeta.get(ws)?.role ?? 'editor';

  if (messageType === MESSAGE_SYNC) {
    const subType = decoding.readVarUint(decoder);
    if (role === 'viewer' && subType !== syncProtocol.messageYjsSyncStep1) {
      return;
    }

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    switch (subType) {
      case syncProtocol.messageYjsSyncStep1:
        syncProtocol.readSyncStep1(decoder, encoder, room.doc);
        break;
      case syncProtocol.messageYjsSyncStep2:
        syncProtocol.readSyncStep2(decoder, room.doc, ws);
        break;
      case syncProtocol.messageYjsUpdate:
        syncProtocol.readUpdate(decoder, room.doc, ws);
        break;
      default:
        throw new Error('Unknown sync message type');
    }
    if (encoding.length(encoder) > 1) {
      ws.send(encoding.toUint8Array(encoder));
    }
  } else if (messageType === MESSAGE_AWARENESS) {
    awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), ws);
  }
}

export function sendInitialState(room, ws) {
  const syncEncoder = encoding.createEncoder();
  encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(syncEncoder, room.doc);
  ws.send(encoding.toUint8Array(syncEncoder));

  const states = room.awareness.getStates();
  if (states.size > 0) {
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      awarenessEncoder,
      awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(states.keys()))
    );
    ws.send(encoding.toUint8Array(awarenessEncoder));
  }
}

export function getRecentEditors(ownerId, projectId, filePath) {
  const room = rooms.get(roomKey(ownerId, projectId, filePath));
  if (!room) return [];
  const cutoff = Date.now() - RECENT_EDITORS_TTL_MS;
  const editors = [];
  for (const [userId, { email, at }] of room.recentEditors) {
    if (at >= cutoff) editors.push({ userId, email, at });
  }
  editors.sort((a, b) => b.at - a.at);
  return editors;
}

// Flushes every live room for a project to disk immediately — used before
// operations that read the working tree directly (compile, git status/
// commit/push) so they see the latest collaborative edits even if the
// debounce window hasn't elapsed yet.
export async function flushProject(ownerId, projectId) {
  const prefix = `${ownerId}\u0000${projectId}\u0000`;
  const pending = [];
  for (const [key, room] of rooms) {
    if (key.startsWith(prefix) && room.persistTimer) {
      pending.push(persistRoom(room));
    }
  }
  await Promise.all(pending);
}

// Saves a room now and frees it if nobody is editing. Background sync touches
// every text file in a project and shouldn't leave them all in memory.
export async function releaseRoom(room) {
  await persistRoom(room);
  if (room.conns.size === 0 && rooms.get(roomKey(room.ownerId, room.projectId, room.filePath)) === room) {
    rooms.delete(roomKey(room.ownerId, room.projectId, room.filePath));
    clearInterval(room.diskTimer);
    room.doc.destroy();
  }
}

// One round of the merge a laptop runs for a file: its changes go in, and what
// it hasn't seen comes back. Works with the room rather than the file so people
// editing right now see the result live.
export async function exchangeDoc(ownerId, projectId, filePath, { stateVector, update }) {
  const room = await getRoom(ownerId, projectId, filePath);
  if (update) Y.applyUpdate(room.doc, update, 'sync');
  const result = {
    stateVector: Y.encodeStateVector(room.doc),
    update: Y.encodeStateAsUpdate(room.doc, stateVector ?? undefined),
  };
  await releaseRoom(room);
  return result;
}

// Replaces a file's text while keeping its history.
export async function replaceText(ownerId, projectId, filePath, text) {
  const room = await getRoom(ownerId, projectId, filePath);
  applyTextDiff(room.doc, text);
  await releaseRoom(room);
}

function closeRoom(key, room) {
  clearTimeout(room.persistTimer);
  clearInterval(room.diskTimer);
  for (const conn of room.conns.keys()) {
    conn.close(4000, 'file replaced');
  }
  rooms.delete(key);
  room.doc.destroy();
}

// Takes on another copy's history for a file, used when the two share none (a
// version restore on the server starts a new one). Open editors are sent away
// because their own saved doc belongs to the old history; the generation bump
// gives them a new local store when they come back.
export async function adoptDoc(ownerId, projectId, filePath, update) {
  const key = roomKey(ownerId, projectId, filePath);
  const room = rooms.get(key);
  if (room) closeRoom(key, room);

  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  const target = ydocStatePath(ownerId, projectId, filePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(await resolveUserPath(ownerId, projectId, filePath), doc.getText('content').toString());
  await fs.writeFile(target, Buffer.from(Y.encodeStateAsUpdate(doc)));
  doc.destroy();
  await updateManifest(ownerId, projectId, (manifest) => ({
    ...manifest,
    collabGeneration: (manifest.collabGeneration ?? 0) + 1,
  }));
}

// A deleted file's room must not write it back on its next save.
export async function forgetFile(ownerId, projectId, filePath) {
  const key = roomKey(ownerId, projectId, filePath);
  const room = rooms.get(key);
  if (room) closeRoom(key, room);
  await dropYdocState(ownerId, projectId, filePath);
}

// Called after a version restore, which overwrites files on disk out from
// under any live Y.Doc. Disconnects every connection for the project (they
// reconnect automatically and get a fresh room seeded from the restored
// file) and discards the in-memory rooms so stale CRDT state can't later
// get persisted back over the restored content.
export function invalidateProject(ownerId, projectId) {
  const prefix = `${ownerId}\u0000${projectId}\u0000`;
  for (const [key, room] of rooms) {
    if (key.startsWith(prefix)) closeRoom(key, room);
  }
  // The saved doc binaries describe pre-restore content — the content
  // check in getRoom would reject them anyway, but clean them up now.
  fs.rm(path.join(projectDir(ownerId, projectId), '.quireloop-ydoc'), { recursive: true, force: true }).catch(() => {});
}
