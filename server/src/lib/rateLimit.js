// In-memory sliding-window login rate limiter. Zero-dependency, single
// process only — fine for a lab-scale self-hosted deployment; a restart
// clears all counters.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const BLOCK_MS = 15 * 60 * 1000;

// key -> { failures: number[] (timestamps), blockedUntil: number|null }
const buckets = new Map();

export function registerFailure(key) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { failures: [], blockedUntil: null };
    buckets.set(key, bucket);
  }
  bucket.failures = bucket.failures.filter((t) => now - t < WINDOW_MS);
  bucket.failures.push(now);
  if (bucket.failures.length >= MAX_FAILURES) {
    bucket.blockedUntil = now + BLOCK_MS;
  }
}

// Returns false if not blocked, or the number of seconds until retry.
export function isBlocked(key) {
  const bucket = buckets.get(key);
  if (!bucket?.blockedUntil) return false;
  const now = Date.now();
  if (now >= bucket.blockedUntil) {
    bucket.blockedUntil = null;
    bucket.failures = [];
    return false;
  }
  return Math.ceil((bucket.blockedUntil - now) / 1000);
}

export function clear(key) {
  buckets.delete(key);
}

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    const stillBlocked = bucket.blockedUntil && now < bucket.blockedUntil;
    const hasRecentFailures = bucket.failures.some((t) => now - t < WINDOW_MS);
    if (!stillBlocked && !hasRecentFailures) buckets.delete(key);
  }
}, 5 * 60 * 1000);
cleanup.unref();
