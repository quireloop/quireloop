import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nanoid } from 'nanoid';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync.js';
import * as awarenessProtocol from 'y-protocols/awareness.js';
import * as encoding from 'lib0/encoding.js';
import * as decoding from 'lib0/decoding.js';
import { SYNC_CONNECTION_FILE } from '../config.js';
import * as collab from './collab.js';
import { readJson, withLock, writeJsonAtomic } from './jsonStore.js';
import { ensureGitRepo } from './projectGit.js';
import { listProjects, readManifest, syncFilesFromDisk, updateManifest, writeManifest } from './manifest.js';
import * as projectIndex from './projectIndex.js';
import { projectDir, resolveUserPath } from './storage.js';
import { isSyncablePath, listSyncFiles, sha256 } from './syncFiles.js';
import { openSocket, request } from './syncTransport.js';

// The laptop end of syncing. People edit only the copy on this computer, which
// is why losing the network changes nothing for them. This keeps that copy and
// the server's in step:
//   - every paper is copied here and checked for changes every SYNC_INTERVAL_MS;
//   - text merges through its Yjs history, so edits made on both sides while
//     apart all survive, whoever comes back first;
//   - other files have no merge, so if both sides changed one, both are kept;
//   - a file someone has open also gets a live link to the server, so keystrokes
//     and cursors travel as they happen.

const SYNC_INTERVAL_MS = 30 * 1000;
const BRIDGE_RETRY_MS = 5 * 1000;
const BRIDGE_PING_MS = 20 * 1000;
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
// Losing most of a paper at once looks like a damaged copy, not a decision.
const MASS_DELETE_MIN_FILES = 3;
const MASS_DELETE_SHARE = 0.5;

let connection = null;
let timer = null;
let cycle = null;
let log = console;
const bridges = new Map(); // room -> Bridge
const status = { state: 'disconnected', lastSyncAt: null, lastError: null, notices: [] };

function notice(message) {
  if (status.notices.some((n) => n.message === message)) return;
  status.notices = [{ message, at: new Date().toISOString() }, ...status.notices].slice(0, 20);
}

export function getStatus() {
  return {
    ...status,
    url: connection?.url ?? null,
    deviceName: connection?.deviceName ?? null,
  };
}

async function saveConnection() {
  await writeJsonAtomic(SYNC_CONNECTION_FILE, connection, { mode: 0o600 });
}

export function defaultDeviceName() {
  return os.hostname().slice(0, 60);
}

export async function startSyncClient(logger) {
  log = logger;
  collab.roomEvents.on('join', onRoomJoin);
  collab.roomEvents.on('leave', onRoomLeave);
  connection = await readJson(SYNC_CONNECTION_FILE, null);
  if (connection) schedule(0);
}

export function stopSyncClient() {
  clearTimeout(timer);
  timer = null;
  for (const bridge of bridges.values()) bridge.stop();
}

export async function connect(next) {
  connection = { ...next, ignored: [] };
  await saveConnection();
  status.notices = [];
  schedule(0);
}

export async function disconnect() {
  const old = connection;
  connection = null;
  clearTimeout(timer);
  for (const bridge of bridges.values()) bridge.stop();
  await fs.rm(SYNC_CONNECTION_FILE, { force: true });
  Object.assign(status, { state: 'disconnected', lastError: null, notices: [] });
  // Best effort: from offline the token stays listed in the server's settings.
  if (old) await request(old, 'DELETE', '/api/sync/device').catch(() => {});
}

export function syncNow() {
  schedule(0);
}

// Removing a copy here shouldn't bring it back next time round.
export async function ignoreRemoteProject(remoteId) {
  if (!connection) return;
  connection.ignored = [...(connection.ignored ?? []), remoteId];
  await saveConnection();
}

function schedule(delay) {
  clearTimeout(timer);
  timer = setTimeout(runCycle, delay);
  timer.unref?.();
}

function runCycle() {
  cycle ??= syncEverything()
    .catch((err) => {
      // A proxy answers 502 while the server behind it restarts.
      if (err.offline || err.status >= 500) {
        status.state = 'offline';
      } else if (err.status === 401) {
        status.state = 'reconnect-needed';
        status.lastError = 'The server no longer accepts this computer. Connect it again.';
      } else {
        status.state = 'error';
        status.lastError = err.message;
        log.warn({ err }, 'sync failed');
      }
    })
    .finally(() => {
      cycle = null;
      if (connection) schedule(SYNC_INTERVAL_MS);
    });
  return cycle;
}

// For tests and for a person pressing "Sync now" who wants to wait for it.
export async function syncOnce() {
  await cycle;
  return runCycle();
}

async function mirrors() {
  const projects = await listProjects(connection.localUserId);
  return projects.filter((p) => p.sync);
}

async function createMirror(remote) {
  const id = nanoid(10);
  const ownerId = connection.localUserId;
  const now = new Date().toISOString();
  await fs.mkdir(projectDir(ownerId, id), { recursive: true });
  const manifest = await writeManifest(ownerId, id, {
    id,
    ownerId,
    collaborators: [],
    collabGeneration: 0,
    name: remote.name,
    mainFile: remote.mainFile,
    compiler: remote.compiler,
    createdAt: now,
    files: [],
    sync: { remoteId: remote.id, role: remote.role },
  });
  await projectIndex.setOwner(id, ownerId);
  await ensureGitRepo(ownerId, id).catch(() => {});
  return manifest;
}

async function syncEverything() {
  const remotes = await request(connection, 'GET', '/api/sync/projects');
  const local = await mirrors();
  const byRemoteId = new Map(local.map((p) => [p.sync.remoteId, p]));
  const remoteIds = new Set(remotes.map((r) => r.id));

  for (const remote of remotes) {
    if (connection.ignored?.includes(remote.id)) continue;
    const mirror = byRemoteId.get(remote.id) ?? (await createMirror(remote));
    await withLock(`sync:${mirror.id}`, () => syncProject(mirror));
  }

  // Taken off the server or no longer shared. Whoever made that change can't
  // reach into this computer: the copy stays as an ordinary local paper.
  for (const mirror of local) {
    if (!remoteIds.has(mirror.sync.remoteId)) {
      await updateManifest(mirror.ownerId, mirror.id, ({ sync: _sync, ...rest }) => rest);
      notice(`"${mirror.name}" is no longer available on the server. This computer keeps its copy.`);
    }
  }

  Object.assign(status, { state: 'online', lastSyncAt: new Date().toISOString(), lastError: null });
}

function basePath(mirror) {
  return path.join(projectDir(mirror.ownerId, mirror.id), '.quireloop-sync.json');
}

function stamped(relPath) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  const { dir, name, ext } = path.parse(relPath);
  return path.join(dir, `${name}.laptop-${stamp}${ext}`);
}

async function keepConflictCopy(mirror, relPath, content) {
  const copy = stamped(relPath);
  const target = await resolveUserPath(mirror.ownerId, mirror.id, copy);
  await fs.writeFile(target, content);
  notice(`"${relPath}" changed in both places in "${mirror.name}". Your version is saved as "${copy}".`);
}

async function syncProject(mirror) {
  const { remoteId } = mirror.sync;
  const route = `/api/sync/projects/${remoteId}`;
  const remote = await request(connection, 'GET', `${route}/state`);
  const canWrite = remote.role !== 'viewer';

  await collab.flushProject(mirror.ownerId, mirror.id);
  const { files: localList } = await listSyncFiles(mirror.ownerId, mirror.id);
  const localFiles = new Map(localList.map((f) => [f.path, f]));
  const remoteFiles = new Map(remote.files.filter((f) => isSyncablePath(f.path)).map((f) => [f.path, f]));
  const base = await readJson(basePath(mirror), {});
  const nextBase = {};

  const removedHere = [...remoteFiles.keys()].filter((p) => !localFiles.has(p) && base[p] === remoteFiles.get(p).sha256);
  const removedThere = [...localFiles.keys()].filter((p) => !remoteFiles.has(p) && base[p] === localFiles.get(p).sha256);
  const tracked = Object.keys(base).length;
  const tooMany = (count) => count >= MASS_DELETE_MIN_FILES && count > tracked * MASS_DELETE_SHARE;
  const holdDeletes = tooMany(removedHere.length) || tooMany(removedThere.length);
  if (holdDeletes) {
    notice(`Many files in "${mirror.name}" disappeared on one side. Nothing was deleted; the missing files were restored.`);
  }

  for (const relPath of new Set([...localFiles.keys(), ...remoteFiles.keys()])) {
    const here = localFiles.get(relPath);
    const there = remoteFiles.get(relPath);
    const previous = base[relPath];

    if (here && there) {
      if (here.sha256 === there.sha256) {
        nextBase[relPath] = here.sha256;
      } else if (here.text && there.text) {
        nextBase[relPath] = await mergeText(mirror, relPath, { canWrite, previous });
      } else if (!canWrite || previous === here.sha256) {
        await download(mirror, relPath);
        nextBase[relPath] = there.sha256;
      } else if (previous === there.sha256) {
        await upload(mirror, relPath);
        nextBase[relPath] = here.sha256;
      } else {
        await keepConflictCopy(mirror, relPath, await readLocal(mirror, relPath));
        await download(mirror, relPath);
        nextBase[relPath] = there.sha256;
      }
    } else if (there) {
      if (canWrite && previous === there.sha256 && !holdDeletes) {
        await request(connection, 'DELETE', `${route}/raw?path=${encodeURIComponent(relPath)}`);
      } else if (there.text) {
        nextBase[relPath] = await mergeText(mirror, relPath, { canWrite, previous: null });
      } else {
        await download(mirror, relPath);
        nextBase[relPath] = there.sha256;
      }
    } else if (previous === here.sha256 && !holdDeletes) {
      await collab.forgetFile(mirror.ownerId, mirror.id, relPath);
      await fs.rm(await resolveUserPath(mirror.ownerId, mirror.id, relPath), { force: true });
    } else if (!canWrite) {
      continue;
    } else if (here.text) {
      nextBase[relPath] = await mergeText(mirror, relPath, { canWrite, previous: null });
    } else {
      await upload(mirror, relPath);
      nextBase[relPath] = here.sha256;
    }
  }

  await writeJsonAtomic(basePath(mirror), nextBase);
  await syncFilesFromDisk(mirror.ownerId, mirror.id);
  if (remote.tooLarge?.length) notice(`Too large to copy from "${mirror.name}": ${remote.tooLarge.join(', ')}`);
  await updateManifest(mirror.ownerId, mirror.id, (manifest) => ({
    ...manifest,
    name: remote.name,
    mainFile: remote.mainFile,
    compiler: remote.compiler,
    sync: { ...manifest.sync, role: remote.role },
  }));
}

async function readLocal(mirror, relPath) {
  return fs.readFile(await resolveUserPath(mirror.ownerId, mirror.id, relPath));
}

async function download(mirror, relPath) {
  const route = `/api/sync/projects/${mirror.sync.remoteId}/raw?path=${encodeURIComponent(relPath)}`;
  const content = await request(connection, 'GET', route);
  const target = await resolveUserPath(mirror.ownerId, mirror.id, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

async function upload(mirror, relPath) {
  const route = `/api/sync/projects/${mirror.sync.remoteId}/raw?path=${encodeURIComponent(relPath)}`;
  await request(connection, 'PUT', route, {
    body: await readLocal(mirror, relPath),
    headers: { 'content-type': 'application/octet-stream' },
  });
}

function base64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(value) {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

// Two copies of a file are safe to merge only if they grew from one history.
// Merging unrelated ones would leave the whole text in the file twice. The
// writers recorded in each copy show it: related copies always share one.
function sharesHistory(vectorA, vectorB) {
  const a = Y.decodeStateVector(vectorA);
  const b = Y.decodeStateVector(vectorB);
  if (a.size === 0 || b.size === 0) return true;
  return [...a.keys()].some((client) => b.has(client));
}

function textOf(update) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  const text = doc.getText('content').toString();
  doc.destroy();
  return text;
}

// Brings one text file into step and returns the hash both sides now share.
async function mergeText(mirror, relPath, { canWrite, previous }) {
  const { ownerId, id } = mirror;
  const route = `/api/sync/projects/${mirror.sync.remoteId}/doc`;
  const target = await resolveUserPath(ownerId, id, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await (await fs.open(target, 'a')).close();

  const room = await collab.getRoom(ownerId, id, relPath);
  const remote = await request(connection, 'POST', route, {
    json: { path: relPath, stateVector: base64(Y.encodeStateVector(room.doc)) },
  });
  const remoteVector = fromBase64(remote.stateVector);

  if (!sharesHistory(Y.encodeStateVector(room.doc), remoteVector)) {
    await resolveUnrelated(mirror, relPath, room, remote, { canWrite, previous, route });
  } else {
    Y.applyUpdate(room.doc, fromBase64(remote.update), 'sync');
    if (canWrite) {
      const update = Y.encodeStateAsUpdate(room.doc, remoteVector);
      await request(connection, 'POST', route, { json: { path: relPath, update: base64(update) } });
    }
    await collab.releaseRoom(room);
  }
  return sha256(await fs.readFile(target));
}

// The server's history was restarted, by a version restore or a git pull there.
// The texts can still be compared against what they last agreed on.
async function resolveUnrelated(mirror, relPath, room, remote, { canWrite, previous, route }) {
  const { ownerId, id } = mirror;
  const localText = room.doc.getText('content').toString();
  const remoteUpdate = fromBase64(remote.update);
  const remoteText = textOf(remoteUpdate);
  const unchangedHere = previous === sha256(Buffer.from(localText));
  const unchangedThere = previous === sha256(Buffer.from(remoteText));

  if (unchangedThere && !unchangedHere && canWrite) {
    const merged = await request(connection, 'POST', route, { json: { path: relPath, replaceWith: localText } });
    await collab.adoptDoc(ownerId, id, relPath, fromBase64(merged.update));
    return;
  }
  if (!unchangedHere && localText && localText !== remoteText) {
    await keepConflictCopy(mirror, relPath, localText);
  }
  await collab.adoptDoc(ownerId, id, relPath, remoteUpdate);
}

// Publishing a paper that was written on this computer.
export async function publishProject(manifest) {
  const remote = await request(connection, 'POST', '/api/sync/projects', {
    json: { name: manifest.name, mainFile: manifest.mainFile, compiler: manifest.compiler },
  });
  const mirror = await updateManifest(manifest.ownerId, manifest.id, (m) => ({
    ...m,
    sync: { remoteId: remote.id, role: 'owner' },
  }));
  await withLock(`sync:${mirror.id}`, () => syncProject(mirror));
  return mirror;
}

// Live link for one open file: this computer's room joins the server's room as
// one more participant, passing edits and cursors along in both directions.
class Bridge {
  constructor(room, mirror) {
    this.room = room;
    this.mirror = mirror;
    this.stopped = false;
    this.remoteClients = new Set();
    this.onDocUpdate = (update, origin) => {
      if (origin === this) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.send(encoding.toUint8Array(encoder));
    };
    this.onAwareness = ({ added, updated, removed }, origin) => {
      if (origin === this) return;
      this.sendAwareness(added.concat(updated, removed));
    };
  }

  send(message) {
    if (this.ws?.readyState === 1) this.ws.send(message);
  }

  sendAwareness(clients) {
    if (clients.length === 0) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.room.awareness, clients));
    this.send(encoding.toUint8Array(encoder));
  }

  async start() {
    if (this.stopped || !connection) return;
    try {
      // Checks the two histories belong together before joining them live.
      await withLock(`sync:${this.mirror.id}`, async () => {
        const base = await readJson(basePath(this.mirror), {});
        await mergeText(this.mirror, this.room.filePath, {
          canWrite: this.mirror.sync.role !== 'viewer',
          previous: base[this.room.filePath],
        });
      });
    } catch {
      this.retry();
      return;
    }
    if (this.stopped) return;

    const relPath = this.room.filePath.split('/').map(encodeURIComponent).join('/');
    const ws = openSocket(connection, `/ws/${this.mirror.sync.remoteId}/${relPath}`);
    this.ws = ws;
    ws.on('open', () => {
      this.room.doc.on('update', this.onDocUpdate);
      this.room.awareness.on('update', this.onAwareness);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.room.doc);
      this.send(encoding.toUint8Array(encoder));
      this.sendAwareness([...this.room.awareness.getStates().keys()]);
      this.alive = true;
      this.ping = setInterval(() => {
        if (!this.alive) ws.terminate();
        this.alive = false;
        ws.ping();
      }, BRIDGE_PING_MS);
    });
    ws.on('pong', () => {
      this.alive = true;
    });
    ws.on('message', (data) => {
      try {
        this.receive(new Uint8Array(data));
      } catch (err) {
        log.warn({ err }, 'bad message on live link');
        ws.close();
      }
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      this.detach();
      this.retry();
    });
  }

  receive(message) {
    const decoder = decoding.createDecoder(message);
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_SYNC) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, this.room.doc, this);
      if (encoding.length(encoder) > 1) this.send(encoding.toUint8Array(encoder));
    } else if (type === MESSAGE_AWARENESS) {
      const update = decoding.readVarUint8Array(decoder);
      const before = new Set(this.room.awareness.getStates().keys());
      awarenessProtocol.applyAwarenessUpdate(this.room.awareness, update, this);
      for (const client of this.room.awareness.getStates().keys()) {
        if (!before.has(client)) this.remoteClients.add(client);
      }
    }
  }

  // Other people's cursors shouldn't linger here once they can't be followed.
  detach() {
    clearInterval(this.ping);
    this.room.doc.off('update', this.onDocUpdate);
    this.room.awareness.off('update', this.onAwareness);
    awarenessProtocol.removeAwarenessStates(this.room.awareness, [...this.remoteClients], this);
    this.remoteClients.clear();
    this.ws = null;
  }

  retry() {
    if (this.stopped) return;
    this.retryTimer = setTimeout(() => this.start(), BRIDGE_RETRY_MS);
    this.retryTimer.unref?.();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.ws?.close();
    bridges.delete(this.room);
  }
}

async function onRoomJoin(room) {
  if (!connection || bridges.has(room)) return;
  const bridge = new Bridge(room, null);
  bridges.set(room, bridge);
  const manifest = await readManifest(room.ownerId, room.projectId).catch(() => null);
  if (!manifest?.sync) {
    bridge.stopped = true;
    bridges.delete(room);
    return;
  }
  bridge.mirror = manifest;
  bridge.start();
}

function onRoomLeave(room) {
  if (room.conns.size === 0) bridges.get(room)?.stop();
}
