import { execa } from 'execa';
import path from 'node:path';
import { projectDir } from './storage.js';

const ENGINE_FLAGS = {
  pdflatex: '-pdf',
  xelatex: '-xelatex',
  lualatex: '-lualatex',
};

// Compiles a project's main file with latexmk. Never throws for LaTeX
// compile failures (non-zero latexmk exit) — only for infra problems
// (e.g. latexmk not found), which callers should treat as a 500.
export async function compileProject(ownerId, projectId, mainFile, compiler = 'pdflatex') {
  const cwd = projectDir(ownerId, projectId);
  const outdir = 'build';
  const engineFlag = ENGINE_FLAGS[compiler] ?? ENGINE_FLAGS.pdflatex;

  try {
    const result = await execa(
      'latexmk',
      // -g forces a full rebuild every time: without it, latexmk skips
      // recompiling (and skips emitting fresh error text) whenever it thinks
      // sources are unchanged since the last run, even if that run failed.
      // -synctex=1 produces a .synctex.gz for PDF<->source jumping.
      [
        engineFlag,
        '-g',
        '-synctex=1',
        '-interaction=nonstopmode',
        '-halt-on-error',
        '-file-line-error',
        `-outdir=${outdir}`,
        mainFile,
      ],
      { cwd, timeout: 60_000, reject: false }
    );

    const log = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    const success = result.exitCode === 0;
    const pdfName = mainFile.replace(/\.tex$/, '.pdf');

    return {
      success,
      log,
      pdfPath: success ? path.join(outdir, pdfName) : null,
    };
  } catch (err) {
    // execa with reject:false shouldn't throw for process errors, but guard
    // against spawn-level failures (e.g. latexmk missing from PATH).
    return { success: false, log: err.message, pdfPath: null };
  }
}

export async function cleanProject(ownerId, projectId, mainFile) {
  const cwd = projectDir(ownerId, projectId);
  const outdir = 'build';
  try {
    await execa('latexmk', ['-C', `-outdir=${outdir}`, mainFile], { cwd, timeout: 30_000, reject: false });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
