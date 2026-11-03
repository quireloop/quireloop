import { execa } from 'execa';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { projectDir } from './storage.js';
import { withLock } from './jsonStore.js';
import { sandboxCommand } from './compileSandbox.js';

const ENGINE_FLAGS = {
  pdflatex: '-pdf',
  xelatex: '-xelatex',
  lualatex: '-lualatex',
};

// A latexmk run is CPU-bound and can burn its full 60s budget. Nothing
// previously limited how many could run at once, so a handful of people
// hitting Compile — or one project with auto-compile-on-idle enabled and
// several collaborators typing — could spawn enough concurrent LaTeX
// processes to saturate the box and stall the server for everyone.
//
// Cap it at roughly half the cores (min 2), leaving headroom for the event
// loop and everything else the server is doing.
const MAX_CONCURRENT_COMPILES = Math.max(2, Math.floor(os.cpus().length / 2));

let active = 0;
const waiting = [];

async function acquireCompileSlot() {
  if (active < MAX_CONCURRENT_COMPILES) {
    active += 1;
    return;
  }
  await new Promise((resolve) => waiting.push(resolve));
  active += 1;
}

function releaseCompileSlot() {
  active -= 1;
  waiting.shift()?.();
}

async function withCompileSlot(fn) {
  await acquireCompileSlot();
  try {
    return await fn();
  } finally {
    releaseCompileSlot();
  }
}

// Where the compiled PDF lands, relative to the project directory. latexmk
// names its outputs after the job name — the main file's *basename* — and
// puts them straight into -outdir, so a main file at `ms/paper.tex` produces
// `build/paper.pdf`, not `build/ms/paper.pdf`. Deriving it from the full
// path made every subfolder main file look like a failed compile.
// The compile check, the PDF route and SyncTeX all go through this.
export function pdfPathFor(mainFile) {
  return path.join('build', `${path.basename(mainFile, '.tex')}.pdf`);
}

// Compiles a project's main file with latexmk. Never throws for LaTeX
// compile failures (non-zero latexmk exit) — only for infra problems
// (e.g. latexmk not found), which callers should treat as a 500.
export async function compileProject(ownerId, projectId, mainFile, compiler = 'pdflatex') {
  const cwd = projectDir(ownerId, projectId);
  // Two compiles of the *same* project share one build/ directory, so they'd
  // interleave writes to the same .aux/.fls/.synctex files and corrupt each
  // other's intermediate state. The per-project lock serializes those; the
  // global slot below bounds how many different projects compile at once.
  return withLock(`compile:${cwd}`, () => withCompileSlot(() => runLatexmk(cwd, mainFile, compiler)));
}

// Papers are untrusted input: anyone who can edit a project decides what TeX
// runs, as the service user that can read every project and the session key.
// -norc ignores a project's .latexmkrc, which is Perl that latexmk would run.
// That stops only latexmk: TeX reads anywhere the service user can (TeX Live
// 2026 made openin_any a no-op, and LuaTeX never honoured it), and LuaTeX
// writes anywhere too, so the real wall is lib/compileSandbox.js.
const SANDBOX_FLAGS = ['-norc'];

// The main file is passed to latexmk as an argument, where a name starting
// with a dash would be read as an option, and latexmk's -e option runs Perl.
export function isSafeMainFile(mainFile) {
  if (typeof mainFile !== 'string' || !mainFile.endsWith('.tex')) return false;
  if (path.isAbsolute(mainFile)) return false;
  // Backslash too: Windows treats it as a folder separator.
  return !mainFile.split(/[\\/]/).some((part) => part === '..' || part.startsWith('-'));
}

async function runLatexmk(cwd, mainFile, compiler) {
  if (!isSafeMainFile(mainFile)) {
    return { success: false, log: `Can't compile "${mainFile}": not a .tex file in this project.`, pdfPath: null };
  }
  const outdir = 'build';
  const engineFlag = ENGINE_FLAGS[compiler] ?? ENGINE_FLAGS.pdflatex;
  const pdfPath = pdfPathFor(mainFile);

  // Otherwise a totally broken compile (source now fails outright) would
  // leave a stale PDF from the last *successful* run sitting in build/,
  // and the disk-existence check below would wrongly call that success.
  await fs.rm(path.join(cwd, pdfPath), { force: true });

  try {
    const { file, args, options, after } = await sandboxCommand(cwd, [
      'latexmk',
      // -g forces a full rebuild every time: without it, latexmk skips
      // recompiling (and skips emitting fresh error text) whenever it thinks
      // sources are unchanged since the last run, even if that run failed.
      // -synctex=1 produces a .synctex.gz for PDF<->source jumping.
      // No -halt-on-error: that stops at the very first error (an
      // "Emergency stop", zero output) instead of pushing through like
      // other hosted compilers do. -interaction=nonstopmode alone already prevents
      // hanging on a prompt; LaTeX will skip a missing package/command and
      // keep going, usually still reaching \end{document} with a real PDF
      // even when the log has errors in it.
      ...SANDBOX_FLAGS,
      engineFlag,
      '-g',
      '-synctex=1',
      '-interaction=nonstopmode',
      '-file-line-error',
      `-outdir=${outdir}`,
      mainFile,
    ]);
    const result = await execa(file, args, { ...options, timeout: 60_000, reject: false });
    await after();

    const log = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    // latexmk/pdflatex exit non-zero whenever the log has any error in it,
    // even if a PDF was still produced (the UI shows that PDF with the
    // errors listed alongside it, rather than nothing) — so success is
    // "did a PDF actually come out of this", checked on disk, not the exit
    // code alone.
    const pdfExists = await fs
      .access(path.join(cwd, pdfPath))
      .then(() => true)
      .catch(() => false);

    return {
      success: pdfExists,
      log,
      pdfPath: pdfExists ? pdfPath : null,
    };
  } catch (err) {
    // execa with reject:false shouldn't throw for process errors, but guard
    // against spawn-level failures (e.g. latexmk missing from PATH).
    return { success: false, log: err.message, pdfPath: null };
  }
}

export async function cleanProject(ownerId, projectId, mainFile) {
  const cwd = projectDir(ownerId, projectId);
  if (!isSafeMainFile(mainFile)) return { ok: false, error: 'invalid main file' };
  // Shares build/ with compileProject — taking the same lock keeps a clean
  // from deleting intermediates out from under an in-flight compile.
  return withLock(`compile:${cwd}`, async () => {
    try {
      const { file, args, options, after } = await sandboxCommand(cwd, [
        'latexmk',
        ...SANDBOX_FLAGS,
        '-C',
        '-outdir=build',
        mainFile,
      ]);
      await execa(file, args, { ...options, timeout: 30_000, reject: false });
      await after();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}
