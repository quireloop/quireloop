import { execa } from 'execa';
import path from 'node:path';
import { projectDir } from './storage.js';

function pdfNameFor(mainFile) {
  return mainFile.replace(/\.tex$/, '.pdf');
}

// Reverse sync: a click position on the rendered PDF -> the source file/line
// that produced it. Coordinates are in PDF points (72dpi), top-left origin,
// matching synctex's own convention (and pdf.js's, conveniently).
export async function toSource(ownerId, projectId, mainFile, page, x, y) {
  const cwd = projectDir(ownerId, projectId);
  const pdfPath = path.join('build', pdfNameFor(mainFile));
  const result = await execa('synctex', ['edit', '-o', `${page}:${x}:${y}:${pdfPath}`], {
    cwd,
    reject: false,
  });
  const inputMatch = result.stdout.match(/^Input:(.+)$/m);
  const lineMatch = result.stdout.match(/^Line:(\d+)$/m);
  if (!inputMatch || !lineMatch) return null;

  // synctex reports an absolute path (sometimes with a "/./ " segment);
  // convert back to the project-relative path our file API expects.
  const absoluteInput = path.normalize(inputMatch[1].trim());
  const relative = path.relative(cwd, absoluteInput);
  return { file: relative, line: Number(lineMatch[1]) };
}

// Forward sync: a source file/line -> where it landed on the PDF page.
// A line can produce multiple output records (one per word/box); we take
// the first, which is what most editors do.
export async function toPdf(ownerId, projectId, mainFile, file, line) {
  const cwd = projectDir(ownerId, projectId);
  const pdfPath = path.join('build', pdfNameFor(mainFile));
  const result = await execa('synctex', ['view', '-i', `${line}:0:${file}`, '-o', pdfPath], {
    cwd,
    reject: false,
  });
  const pageMatch = result.stdout.match(/^Page:(\d+)/m);
  const xMatch = result.stdout.match(/^x:([\d.]+)/m);
  const yMatch = result.stdout.match(/^y:([\d.]+)/m);
  if (!pageMatch || !xMatch || !yMatch) return null;

  return { page: Number(pageMatch[1]), x: Number(xMatch[1]), y: Number(yMatch[1]) };
}
