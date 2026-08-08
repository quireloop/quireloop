import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Every piece of Quireloop's state is a JSON file that gets read, mutated in
// memory, and written back (users.json, manifest.json, the project indexes,
// share links, invites). Node serves requests concurrently, so two overlapping
// requests would both read the same starting state and the second write would
// clobber the first — a silent lost update. Measured before this module
// existed: 20 concurrent signups persisted 1 user, and 15 concurrent file
// saves left 14 files on disk but only 9 in the manifest.
//
// Two problems, two fixes, both here:
//
//   1. Lost updates      -> withLock(): a per-key promise chain that serializes
//                           read-modify-write cycles on the same file.
//   2. Torn/partial files -> writeJsonAtomic(): write a temp file, fsync it,
//                           rename it over the target (atomic on POSIX), then
//                           fsync the directory so the rename itself survives
//                           a crash. A reader never sees a half-written file.
//
// The lock is in-process only, which matches the deployment model — a single
// Node process owning its data directory. Running two servers over one data
// dir would still race; that's a documented non-goal, not an oversight.

// key -> promise representing the tail of that key's operation queue
const chains = new Map();

// Serializes async operations sharing a key. Each caller waits for the current
// tail, then becomes the new tail. Rejections are contained so one failed
// operation never poisons the queue for the next caller.
export function withLock(key, fn) {
  // The stored tail below already swallows rejections, so `previous` settles
  // fulfilled either way and `fn` always runs.
  const previous = chains.get(key) ?? Promise.resolve();
  const result = previous.then(fn);
  // The stored tail swallows rejections; the returned promise still rejects.
  const tail = result.then(
    () => {},
    () => {}
  );
  chains.set(key, tail);
  // Drop the entry once this is the last queued operation, so the Map doesn't
  // grow without bound over the life of the process.
  tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return result;
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    // Missing file (first run) and corrupt file both fall back. Callers treat
    // the fallback as "empty", which is the pre-existing behaviour.
    return typeof fallback === 'function' ? fallback() : fallback;
  }
}

// Durably replaces `file` with `value`. Never leaves a partially written file
// at the target path, even if the process dies mid-write.
export async function writeJsonAtomic(file, value, { mode } = {}) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${crypto.randomBytes(6).toString('hex')}.tmp`);

  let handle;
  try {
    handle = await fs.open(tmp, 'w', mode ?? 0o644);
    await handle.writeFile(JSON.stringify(value, null, 2));
    // Flush this file's contents before the rename makes it visible.
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tmp, file);

    // The rename is atomic but not automatically durable — without this, a
    // power loss right after can leave the directory entry pointing nowhere.
    let dirHandle;
    try {
      dirHandle = await fs.open(dir, 'r');
      await dirHandle.sync();
    } catch {
      // Directory fsync is unsupported on some filesystems (and on Windows);
      // the rename still happened, so this is not worth failing the write for.
    } finally {
      await dirHandle?.close();
    }
  } catch (err) {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

// The read-modify-write cycle every caller actually wants: takes the file's
// lock, reads current state, hands it to `mutate`, and atomically writes back
// whatever that returns. Return the mutated value (or a fresh one); returning
// undefined skips the write, which lets a mutator bail out without changing
// anything.
//
// `mutate` may also stash a result on the passed-in context for the caller —
// but the common case is just returning the new state.
export async function updateJson(file, fallback, mutate, { mode } = {}) {
  return withLock(file, async () => {
    const current = await readJson(file, fallback);
    const next = await mutate(current);
    if (next === undefined) return current;
    await writeJsonAtomic(file, next, { mode });
    return next;
  });
}

// Same as updateJson but for mutators that need to report something back
// (e.g. "was this invite still unused?") alongside the new state. The mutator
// returns { value, result }; `value === undefined` skips the write.
export async function updateJsonWithResult(file, fallback, mutate, { mode } = {}) {
  return withLock(file, async () => {
    const current = await readJson(file, fallback);
    const { value, result } = await mutate(current);
    if (value !== undefined) await writeJsonAtomic(file, value, { mode });
    return result;
  });
}
