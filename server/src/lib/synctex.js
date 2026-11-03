import { execa } from 'execa';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectDir } from './storage.js';
import { pdfPathFor } from './latex.js';

// Reverse sync: a click position on the rendered PDF -> the source file/line
// that produced it. Coordinates are in PDF points (72dpi), top-left origin,
// matching synctex's own convention (and pdf.js's, conveniently).
export async function toSource(ownerId, projectId, mainFile, page, x, y) {
  const cwd = projectDir(ownerId, projectId);
  const result = await execa('synctex', ['edit', '-o', `${page}:${x}:${y}:${pdfPathFor(mainFile)}`], {
    cwd,
    reject: false,
  });
  const inputMatch = result.stdout.match(/^Input:(.+)$/m);
  const lineMatch = result.stdout.match(/^Line:(\d+)$/m);
  const columnMatch = result.stdout.match(/^Column:(-?\d+)$/m);
  if (!inputMatch || !lineMatch) return null;

  // synctex reports an absolute path (sometimes with a "/./" segment), and
  // it is the *real* path: TeX resolved the symlink when it opened the file.
  // A project opened in place is a symlink under data/projects/, so the
  // comparison has to be against the project's realpath too — relative to
  // the link itself, a file in /home/arjun/paper came out as
  // "../../../../home/arjun/paper/main.tex", which no editor tab matches.
  const root = await fs.realpath(cwd);
  const absoluteInput = path.normalize(inputMatch[1].trim());
  const relative = path.relative(root, absoluteInput);
  // A click on text that came from outside the project (a class or package
  // file from the TeX distribution) has nowhere in the editor to go.
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;

  const column = columnMatch ? Number(columnMatch[1]) : -1;
  // The editor names files with forward slashes on every system.
  const file = relative.split(path.sep).join('/');
  return { file, line: Number(lineMatch[1]), column: column >= 0 ? column : null };
}

// Forward sync: a source file/line -> where it landed on the PDF.
//
// One source line usually produces several boxes (a paragraph wrapped over
// lines, or split across a page or column break). All of them are returned
// so the viewer can outline the whole span, instead of
// dropping a dot on the first word. `page`/`x`/`y` describe the first box,
// for scrolling.
export async function toPdf(ownerId, projectId, mainFile, file, line) {
  const cwd = projectDir(ownerId, projectId);
  const result = await execa('synctex', ['view', '-i', `${line}:0:${file}`, '-o', pdfPathFor(mainFile)], {
    cwd,
    reject: false,
  });
  const boxes = parseViewRecords(result.stdout);
  if (boxes.length === 0) return null;
  const first = boxes[0];
  return { page: first.page, x: first.x, y: first.y, boxes };
}

// `synctex view` prints one block per output record:
//   Page:1  x:171.1  y:134.7  h:133.7  v:134.7  W:343.7  H:6.9 ...
// h/v are the box's left edge and *baseline*; W/H its width and height above
// that baseline. Records with no position are dropped, and exact duplicates
// (synctex repeats a box once per nesting level) are collapsed.
export function parseViewRecords(stdout) {
  const records = [];
  let current = null;
  for (const raw of stdout.split('\n')) {
    const match = raw.match(/^(Page|x|y|h|v|W|H):(-?[\d.]+)/);
    if (!match) continue;
    const [, key, value] = match;
    if (key === 'Page') {
      current = { page: Number(value) };
      records.push(current);
    } else if (current) {
      current[key] = Number(value);
    }
  }
  const seen = new Set();
  return records
    .filter((r) => Number.isFinite(r.page) && Number.isFinite(r.x) && Number.isFinite(r.y))
    .map((r) => ({ page: r.page, x: r.x, y: r.y, h: r.h ?? r.x, v: r.v ?? r.y, W: r.W ?? 0, H: r.H ?? 0 }))
    .filter((r) => {
      const key = [r.page, r.h, r.v, r.W, r.H].map((n) => n.toFixed(1)).join(':');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
