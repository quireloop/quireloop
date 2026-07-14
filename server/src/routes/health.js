import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../config.js';

// Read once at boot rather than per-request — the version can't change
// without a restart anyway, and this avoids a disk read on every probe
// from a Docker healthcheck or load balancer hitting this every few seconds.
function readVersion() {
  // server/package.json first (this workspace), falling back to the repo
  // root package.json, since either could carry the version field.
  const candidates = [
    path.join(ROOT_DIR, 'server', 'package.json'),
    path.join(ROOT_DIR, 'package.json'),
  ];
  for (const file of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (pkg.version) return pkg.version;
    } catch {
      // missing/unreadable/invalid JSON — try the next candidate
    }
  }
  return '0.0.0';
}

const VERSION = readVersion();

// No auth on purpose: this is what Docker HEALTHCHECK and any load
// balancer/uptime probe hit, and neither carries a session cookie.
export default async function healthRoutes(app) {
  app.get('/api/health', async () => {
    return { ok: true, version: VERSION };
  });
}
