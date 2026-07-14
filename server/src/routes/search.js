import fs from 'node:fs/promises';
import path from 'node:path';
import { projectDir } from '../lib/storage.js';
import { requireProjectAccess } from '../lib/authMiddleware.js';

const MAX_MATCHES = 200;
const MAX_FILE_BYTES = 1024 * 1024; // 1MB — skip anything bigger, likely not source
const PREVIEW_LEN = 200;

// Directories never worth searching: Quireloop's own bookkeeping (build
// output, version snapshots), git internals, and any dotfile/dot-dir.
const SKIP_DIRS = new Set(['build', 'versions', '.git', '__MACOSX']);

const BINARY_EXTS = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.zip',
  '.gz',
  '.synctex.gz',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.ico',
]);

function isBinaryPath(relPath) {
  if (relPath.endsWith('.synctex.gz')) return true;
  const ext = path.extname(relPath).toLowerCase();
  return BINARY_EXTS.has(ext);
}

async function walkSearchable(root, base = '') {
  const entries = await fs.readdir(path.join(root, base), { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const relPath = base ? `${base}/${entry.name}` : entry.name;
      files = files.concat(await walkSearchable(root, relPath));
    } else {
      const relPath = base ? `${base}/${entry.name}` : entry.name;
      if (relPath === 'manifest.json') continue;
      if (isBinaryPath(relPath)) continue;
      files.push(relPath);
    }
  }
  return files;
}

export default async function searchRoutes(app) {
  app.get('/api/projects/:id/search', { preHandler: requireProjectAccess }, async (req, reply) => {
    const q = (req.query?.q ?? '').toString();
    if (q.length < 2) {
      return reply.code(400).send({ error: 'q must be at least 2 characters' });
    }
    const needle = q.toLowerCase();

    const root = projectDir(req.ownerId, req.params.id);
    const relPaths = await walkSearchable(root);

    const matches = [];
    outer: for (const relPath of relPaths) {
      let stat;
      try {
        stat = await fs.stat(path.join(root, relPath));
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) continue;

      let text;
      try {
        text = await fs.readFile(path.join(root, relPath), 'utf8');
      } catch {
        continue;
      }
      // Binary-ish content that slipped past the extension filter (a stray
      // null byte is a reliable enough signal without pulling in a deps).
      if (text.includes('\0')) continue;

      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lower = line.toLowerCase();
        let from = 0;
        let idx;
        while ((idx = lower.indexOf(needle, from)) !== -1) {
          const preview = line.length > PREVIEW_LEN ? line.slice(0, PREVIEW_LEN) + '…' : line;
          matches.push({
            file: relPath,
            line: i + 1,
            column: idx + 1,
            preview: preview.trim(),
          });
          if (matches.length >= MAX_MATCHES) break outer;
          from = idx + needle.length;
        }
      }
    }

    return { query: q, matches, truncated: matches.length >= MAX_MATCHES };
  });
}
