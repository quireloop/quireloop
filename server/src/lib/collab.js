import fs from 'node:fs/promises';
import path from 'node:path';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync.js';
import * as awarenessProtocol from 'y-protocols/awareness.js';
import * as encoding from 'lib0/encoding.js';
import * as decoding from 'lib0/decoding.js';
import { projectDir, resolveProjectPath } from './storage.js';

// Hand-rolled y-websocket wire protocol — y-websocket v3 ships no
// server-side utilities, only the browser client, so the sync/awareness
// message framing below mirrors the (unpublished-as-a-package) reference
// server implementation: message type 0 = sync step / update, 1 = awareness.
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

const PERSIST_DEBOUNCE_MS = 2000;
const RECENT_EDITORS_TTL_MS = 10 * 60 * 1000;

// One Y.Doc per (ownerId, projectId, filePath) — the "room" that every
// browser tab editing that file connects into. Content is debounce-
// persisted to the real file on disk so compile/git/download keep working
// exactly as before, just fed by whichever content is most current.
const rooms = new Map();

function roomKey(ownerId, projectId, filePath) {
  return `${ownerId}\u0000${projectId}\u0000${filePath}`;
}

async function loadInitialContent(ownerId, projectId, filePath) {
  try {
    return await fs.readFile(resolveProjectPath(ownerId, projectId, filePath), 'utf8');
  } catch {
    return '';
  }
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

async function persistRoom(room) {
  clearTimeout(room.persistTimer);
  room.persistTimer = null;
  const text = room.doc.getText('content').toString();
  try {
    await fs.writeFile(resolveProjectPath(room.ownerId, room.projectId, room.filePath), text);
  } catch {
    // file/project gone (deleted, restored, renamed mid-session) — nothing to persist to
  }
  await persistYdocState(room);
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
  };

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
    const initial = await loadInitialContent(ownerId, projectId, filePath);
    const savedState = await loadYdocState(ownerId, projectId, filePath);
    let restored = false;
    if (savedState) {
      // Restore the previous Y.Doc only if it still reflects the file on
      // disk — if the file was changed outside collab (git pull, zip
      // upload, direct API write), the saved doc is stale and reviving it
      // would resurrect the old content over the external change.
      try {
        const candidate = new Y.Doc();
        Y.applyUpdate(candidate, savedState);
        if (candidate.getText('content').toString() === initial) {
          Y.applyUpdate(room.doc, savedState);
          restored = true;
        }
      } catch {
        // corrupt state file — fall through to a fresh seed
      }
      if (!restored) {
        await dropYdocState(ownerId, projectId, filePath);
      }
    }
    if (!restored && initial) {
      room.doc.getText('content').insert(0, initial);
    }
  }
  return room;
}

export function addConnection(room, ws, userId, email, role = 'editor') {
  room.conns.set(ws, new Set());
  room.connMeta.set(ws, { userId, email, role });
}

export function removeConnection(room, ws) {
  const owned = room.conns.get(ws);
  room.conns.delete(ws);
  room.connMeta.delete(ws);
  if (owned) {
    awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(owned), null);
  }
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

// Called after a version restore, which overwrites files on disk out from
// under any live Y.Doc. Disconnects every connection for the project (they
// reconnect automatically and get a fresh room seeded from the restored
// file) and discards the in-memory rooms so stale CRDT state can't later
// get persisted back over the restored content.
export function invalidateProject(ownerId, projectId) {
  const prefix = `${ownerId}\u0000${projectId}\u0000`;
  for (const [key, room] of rooms) {
    if (!key.startsWith(prefix)) continue;
    clearTimeout(room.persistTimer);
    for (const conn of room.conns.keys()) {
      conn.close(4000, 'project restored');
    }
    rooms.delete(key);
  }
  // The saved doc binaries describe pre-restore content — the content
  // check in getRoom would reject them anyway, but clean them up now.
  fs.rm(path.join(projectDir(ownerId, projectId), '.quireloop-ydoc'), { recursive: true, force: true }).catch(() => {});
}
