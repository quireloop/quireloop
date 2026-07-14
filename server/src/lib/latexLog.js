// Parses a latexmk/pdflatex compile log (run with -file-line-error, see
// lib/latex.js) into a flat list of { file, line, severity, message }
// problems the frontend can show as a structured list + editor gutter
// markers, instead of making users scroll a wall of TeX log text.
//
// Only handles the "classic" patterns TeX/LaTeX actually emits — this is
// not a full TeX log grammar. Anything unrecognized is left out of
// `problems`; the raw log is still shown in the UI as a fallback.

const MAX_PROBLEMS = 100;

function normalizeFile(file, mainFile) {
  if (!file) return mainFile;
  let f = file.trim();
  if (f.startsWith('./')) f = f.slice(2);
  return f;
}

function pushProblem(list, problem) {
  list.push(problem);
}

// `./main.tex:12: Undefined control sequence.` — the primary error format
// once -file-line-error is passed (already the case in lib/latex.js).
const FILE_LINE_ERROR_LINE_RE = /^(\.\/)?([^\s:][^:\n]*\.(?:tex|sty|cls|bib)):(\d+):\s*(.+)$/;

// Lines that mark the end of an error message block (TeX's own follow-up
// context, not a continuation of the message text).
const ERROR_CONTINUATION_STOP_RE = /^(See the|Type\s|l\.\d|!\s|\(|\))/;

// Fallback for the rare "! message" errors that -file-line-error doesn't
// rewrite (e.g. some emergency-stop conditions). We look ahead a few lines
// for the "l.<num>" context TeX prints for most errors.
const BARE_BANG_RE = /^! (.+)$/gm;
const LINE_CONTEXT_RE = /^l\.(\d+)\b/;

const WARNING_START_RE = /^(?:LaTeX|Package|Class|LaTeX Font)\b.*Warning:|^(?:Overfull|Underfull)\s+\\hbox/;

const CITATION_RE = /Citation\s+[`'"]([^'"]+)['"]\s+on page \d+ undefined on input line (\d+)/;
const REFERENCE_RE = /Reference\s+[`'"]([^'"]+)['"]\s+on page \d+ undefined on input line (\d+)/;
const INPUT_LINE_RE = /on input line (\d+)\.?/;
const HBOX_RE = /^(Overfull|Underfull)\s+\\hbox\s*\(([^)]*)\)\s+in paragraph at lines (\d+)--(\d+)/;
const HBOX_RE_SINGLE = /^(Overfull|Underfull)\s+\\hbox\s*\(([^)]*)\)\s+(?:detected )?at line (\d+)/;

// Joins a warning/hbox message that TeX hard-wrapped across lines (log
// output wraps at ~79 columns with no regard for word boundaries) back
// into one logical line, so the regexes above can match it whole.
function collectWarningBlocks(lines) {
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!WARNING_START_RE.test(line)) continue;
    let block = line.trim();
    let j = i;
    while (
      !/\.\s*$/.test(block) &&
      !/at lines? \d+/.test(block) &&
      j - i < 5 &&
      j + 1 < lines.length &&
      lines[j + 1].trim() !== ''
    ) {
      j += 1;
      block += ' ' + lines[j].trim();
    }
    blocks.push(block);
  }
  return blocks;
}

// TeX hard-wraps log output at ~79 columns with no regard for word
// boundaries, so a message can be cut off mid-word (e.g. "...ended by
// \end{docume" / "nt}."). Joins continuation lines back on, stopping at
// blank lines, TeX's own follow-up context ("See the...", "l.<num>", the
// file-stack markers), or once the message reaches a sentence end.
function joinWrappedMessage(lines, startIdx, firstMessage) {
  let message = firstMessage;
  let j = startIdx;
  while (
    !/[.!?]\s*$/.test(message) &&
    j + 1 < lines.length &&
    lines[j + 1].trim() !== '' &&
    !ERROR_CONTINUATION_STOP_RE.test(lines[j + 1]) &&
    j - startIdx < 4
  ) {
    j += 1;
    message += lines[j].trim();
  }
  return message;
}

function parseErrors(log, mainFile) {
  const problems = [];
  const lines = log.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(FILE_LINE_ERROR_LINE_RE);
    if (!m) continue;
    // With -file-line-error TeX rewrites even its closing "==> Fatal
    // error occurred..." summary into file:line: form — it just restates
    // errors already reported above it, so drop it here too.
    if (m[4].trim().startsWith('==>')) continue;
    const message = joinWrappedMessage(lines, i, m[4].trim());
    pushProblem(problems, {
      file: normalizeFile(m[2], mainFile),
      line: Number(m[3]),
      severity: 'error',
      message: message.trim(),
    });
  }

  // Bare "! message" errors not already captured above.
  for (let i = 0; i < lines.length; i++) {
    const bang = lines[i].match(/^! (.+)$/);
    if (!bang) continue;
    // "! ==> Fatal error occurred..." is TeX's closing summary of errors
    // already reported above it — noise, not a distinct problem.
    if (bang[1].startsWith('==>')) continue;
    // Skip if this exact text was already captured via file:line: form
    // (file-line-error rewrites "! " to "file:line: ", so a leftover "! "
    // line here means it genuinely wasn't rewritten).
    let foundLine = null;
    for (let k = i + 1; k < Math.min(i + 6, lines.length); k++) {
      const ctx = lines[k].match(LINE_CONTEXT_RE);
      if (ctx) {
        foundLine = Number(ctx[1]);
        break;
      }
    }
    pushProblem(problems, {
      file: mainFile,
      line: foundLine ?? 1,
      severity: 'error',
      message: bang[1].trim(),
    });
  }

  return problems;
}

function parseWarnings(log, mainFile) {
  const problems = [];
  const lines = log.split('\n');
  const blocks = collectWarningBlocks(lines);

  for (const block of blocks) {
    const citation = block.match(CITATION_RE);
    if (citation) {
      pushProblem(problems, {
        file: mainFile,
        line: Number(citation[2]),
        severity: 'warning',
        message: `Undefined citation '${citation[1]}'`,
      });
      continue;
    }

    const reference = block.match(REFERENCE_RE);
    if (reference) {
      pushProblem(problems, {
        file: mainFile,
        line: Number(reference[2]),
        severity: 'warning',
        message: `Undefined reference '${reference[1]}'`,
      });
      continue;
    }

    const hbox = block.match(HBOX_RE) || block.match(HBOX_RE_SINGLE);
    if (hbox) {
      pushProblem(problems, {
        file: mainFile,
        line: Number(hbox[3]),
        severity: 'warning',
        message: `${hbox[1]} \\hbox (${hbox[2]}) in paragraph`,
      });
      continue;
    }

    const inputLine = block.match(INPUT_LINE_RE);
    if (inputLine) {
      const message = block.slice(0, inputLine.index).replace(/^(?:LaTeX|Package|Class|LaTeX Font)\s*/, '').trim();
      pushProblem(problems, {
        file: mainFile,
        line: Number(inputLine[1]),
        severity: 'warning',
        message: message.replace(/[:\s]+$/, ''),
      });
      continue;
    }
    // No line info we can extract — drop it rather than guess a line.
  }

  return problems;
}

export function parseLatexLog(log, mainFile) {
  if (!log) return [];

  const errors = parseErrors(log, mainFile);
  const warnings = parseWarnings(log, mainFile);

  const seen = new Set();
  const problems = [];
  for (const p of [...errors, ...warnings]) {
    const key = `${p.severity}|${p.file}|${p.line}|${p.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push(p);
    if (problems.length >= MAX_PROBLEMS) break;
  }

  return problems;
}
