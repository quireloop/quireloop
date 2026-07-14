// Zero-dependency line-based diff — classic dynamic-programming LCS over
// lines, O(n*m) time and space. Fine for source files (the size guard below
// keeps it from being asked to diff anything huge).
//
// Output is a flat list of hunks: { type: 'same' | 'add' | 'del', text }.
//
// 5k lines per side caps the DP table at 25M cells (~100MB transient) —
// beyond that the tab would visibly freeze, and no hand-written .tex file
// should be anywhere near it anyway.
const MAX_DIFF_LINES = 5000;

export function tooLargeToDiff(a, b) {
  return a.split('\n').length > MAX_DIFF_LINES || b.split('\n').length > MAX_DIFF_LINES;
}

// Splits on '\n' the same way for both sides, so a trailing newline just
// yields a trailing '' element on each — consistent, not special-cased.
function toLines(text) {
  return text.split('\n');
}

export function diffLines(oldText, newText) {
  const a = toLines(oldText ?? '');
  const b = toLines(newText ?? '');

  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return null; // caller should show "files too large to diff"
  }

  const n = a.length;
  const m = b.length;

  // lcs[i][j] = length of the LCS of a[i:] and b[j:]
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const hunks = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      hunks.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      hunks.push({ type: 'del', text: a[i] });
      i++;
    } else {
      hunks.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) {
    hunks.push({ type: 'del', text: a[i] });
    i++;
  }
  while (j < m) {
    hunks.push({ type: 'add', text: b[j] });
    j++;
  }

  return hunks;
}

// Collapses runs of more than `context` consecutive 'same' hunks into a
// single collapsed marker, for a unified-diff-style render. Short runs
// (<= context) are left alone since they're useful surrounding context.
export function collapseUnchanged(hunks, context = 8) {
  const out = [];
  let run = [];

  function flushRun() {
    if (run.length > context) {
      out.push({ type: 'collapsed', count: run.length });
    } else {
      out.push(...run);
    }
    run = [];
  }

  for (const hunk of hunks) {
    if (hunk.type === 'same') {
      run.push(hunk);
    } else {
      flushRun();
      out.push(hunk);
    }
  }
  flushRun();

  return out;
}
