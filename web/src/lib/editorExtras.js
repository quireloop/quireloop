// Editor helpers:
//   - hover an equation to see it typeset
//   - hover \cite{key} to see the reference
//   - a brief line flash after a SyncTeX jump, and landing on the exact word
//     that was double-clicked in the PDF rather than column 0
import { EditorView, Decoration, hoverTooltip } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import katex from 'katex';
import 'katex/dist/katex.min.css';

// ---------------------------------------------------------------------------
// SyncTeX landing: flash the target line, select the word if we can find it.

const setSyncFlashEffect = StateEffect.define();

export const syncFlashField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setSyncFlashEffect)) {
        deco = effect.value == null
          ? Decoration.none
          : Decoration.set([Decoration.line({ class: 'cm-sync-flash' }).range(effect.value)]);
      }
    }
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// pdf.js hands back typeset text: ligatures as single glyphs, words split by
// a hyphen at a line break, punctuation attached. Undo the parts of that
// which would stop the word matching its source.
const LIGATURES = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };
export function normalizePdfWord(word) {
  return (word ?? '')
    .replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c] ?? c)
    .replace(/[‐‑‒–—-]$/, '')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .trim();
}

// Finds `word` on `lineNumber`, else on the nearest line within a few either
// side (SyncTeX line numbers are often off by one around \par and
// environment boundaries). Returns a { from, to } range or null.
export function findWordNear(doc, lineNumber, word, radius = 3) {
  const needle = normalizePdfWord(word);
  if (needle.length < 2) return null;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}`, 'u');
  for (let d = 0; d <= radius; d++) {
    for (const n of d === 0 ? [lineNumber] : [lineNumber - d, lineNumber + d]) {
      if (n < 1 || n > doc.lines) continue;
      const line = doc.line(n);
      const m = line.text.match(pattern);
      if (m) return { from: line.from + m.index, to: line.from + m.index + needle.length };
    }
  }
  return null;
}

// Moves the cursor to a SyncTeX target — a line number, or { line, word }
// — selects the word when it can be found, and flashes the line.
export function revealSyncTarget(view, target) {
  const { line, word } = typeof target === 'number' ? { line: target } : target;
  const doc = view.state.doc;
  const lineNum = Math.min(Math.max(line || 1, 1), doc.lines);
  const range = word ? findWordNear(doc, lineNum, word) : null;
  const anchorLine = range ? doc.lineAt(range.from) : doc.line(lineNum);
  view.dispatch({
    selection: range ? { anchor: range.from, head: range.to } : { anchor: anchorLine.from },
    effects: [
      EditorView.scrollIntoView(range ? range.from : anchorLine.from, { y: 'center' }),
      setSyncFlashEffect.of(anchorLine.from),
    ],
  });
  view.focus();
  clearTimeout(view.__syncFlashTimer);
  view.__syncFlashTimer = setTimeout(() => {
    // The view may have been destroyed by a file switch in the meantime.
    if (view.dom.isConnected) view.dispatch({ effects: setSyncFlashEffect.of(null) });
  }, 1600);
}

// ---------------------------------------------------------------------------
// Math hover preview.

const DISPLAY_ENVS = 'equation|align|gather|multline|eqnarray|flalign|alignat|displaymath|math';
// KaTeX has no top-level align/gather; their inner "-ed" forms render the
// same rows and columns. Numbering is irrelevant in a preview.
const KATEX_ENV = {
  align: 'aligned', flalign: 'aligned', alignat: 'alignedat', eqnarray: 'aligned',
  gather: 'gathered', multline: 'gathered',
};

const MATH_PATTERNS = [
  { re: new RegExp(`\\\\begin\\{(${DISPLAY_ENVS})(\\*?)\\}([\\s\\S]*?)\\\\end\\{\\1\\2\\}`, 'g'), display: true, env: 1, body: 3 },
  { re: /\\\[([\s\S]*?)\\\]/g, display: true, body: 1 },
  { re: /\$\$([\s\S]+?)\$\$/g, display: true, body: 1 },
  { re: /\\\(([\s\S]*?)\\\)/g, display: false, body: 1 },
  { re: /(?<![\\$])\$(?!\$)((?:\\.|[^$\\\n])+?)\$/g, display: false, body: 1 },
];

// The math span (if any) that contains `pos`. Scans a window around the
// cursor rather than the whole document: hovering has to stay instant on
// a 5,000-line thesis.
export function mathAt(doc, pos) {
  const WINDOW = 6000;
  const start = Math.max(0, pos - WINDOW);
  const text = doc.sliceString(start, Math.min(doc.length, pos + WINDOW));
  const offset = pos - start;
  for (const { re, display, env, body } of MATH_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > offset) break;
      if (offset <= m.index + m[0].length) {
        // A $ inside a %-comment line isn't math.
        const lineStart = text.lastIndexOf('\n', m.index) + 1;
        if (/^\s*%/.test(text.slice(lineStart, m.index + 1))) continue;
        return { tex: m[body], display, env: env ? m[env] : null, from: start + m.index, to: start + m.index + m[0].length };
      }
    }
  }
  return null;
}

export function toKatexSource({ tex, env }) {
  const cleaned = tex
    .replace(/\\label\{[^}]*\}/g, '')
    .replace(/\\(nonumber|notag)\b/g, '')
    .trim();
  const target = env && KATEX_ENV[env];
  if (!target) return cleaned;
  // alignat takes a column count argument; alignedat does too.
  if (target === 'alignedat') return `\\begin{alignedat}${cleaned}\\end{alignedat}`;
  return `\\begin{${target}}${cleaned}\\end{${target}}`;
}

// \newcommand / \renewcommand / \DeclareMathOperator / \def, so a preview of
// $\R^n$ uses the paper's own \R. Brace-counted, like the .bib parser.
function readGroup(text, i) {
  while (/\s/.test(text[i] ?? '')) i++;
  if (text[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}' && --depth === 0) return { value: text.slice(i + 1, j), end: j + 1 };
  }
  return null;
}

export function collectMacros(text) {
  const macros = {};
  const defs = /\\(?:re)?newcommand\*?\s*\{?\s*(\\[A-Za-z@]+)\s*\}?\s*(?:\[\d\])?\s*(?:\[[^\]]*\])?|\\DeclareMathOperator\*?\s*\{\s*(\\[A-Za-z@]+)\s*\}|\\def\s*(\\[A-Za-z@]+)(?:#\d)*/g;
  let m;
  while ((m = defs.exec(text))) {
    const group = readGroup(text, defs.lastIndex);
    if (!group) continue;
    if (m[1]) macros[m[1]] = group.value;
    else if (m[2]) macros[m[2]] = `\\operatorname{${group.value}}`;
    else if (m[3]) macros[m[3]] = group.value;
    defs.lastIndex = group.end;
  }
  return macros;
}

function renderMath(math, macros) {
  const dom = document.createElement('div');
  dom.className = 'cm-math-preview';
  try {
    katex.render(toKatexSource(math), dom, {
      displayMode: math.display,
      throwOnError: true,
      strict: 'ignore',
      trust: false,
      // KaTeX mutates the macros object it is given (for \gdef); hand it a copy.
      macros: { ...macros },
    });
  } catch (err) {
    dom.classList.add('cm-math-preview-error');
    dom.textContent = `Can't preview: ${String(err.message ?? err).replace(/^KaTeX parse error: /, '')}`;
  }
  return dom;
}

// ---------------------------------------------------------------------------
// \cite{key} hover card.

const CITE_RE = /\\\w*[Cc]ite\w*\*?(?:\[[^\]]*\])*\{([^}]*)\}/g;

export function citeKeyAt(lineText, column) {
  CITE_RE.lastIndex = 0;
  let m;
  while ((m = CITE_RE.exec(lineText))) {
    const argStart = m.index + m[0].length - 1 - m[1].length;
    if (column < argStart || column > argStart + m[1].length) continue;
    let cursor = argStart;
    for (const part of m[1].split(',')) {
      if (column >= cursor && column <= cursor + part.length) {
        const key = part.trim();
        return key ? { key, from: cursor, to: cursor + part.length } : null;
      }
      cursor += part.length + 1;
    }
  }
  return null;
}

function shortAuthors(author) {
  const names = author.split(/\s+and\s+/i).map((n) => n.trim()).filter(Boolean);
  const surname = (n) => (n.includes(',') ? n.split(',')[0] : n.split(/\s+/).pop()).replace(/[{}]/g, '');
  if (names.length === 0) return '';
  if (names.length === 1) return surname(names[0]);
  if (names.length === 2) return `${surname(names[0])} and ${surname(names[1])}`;
  return `${surname(names[0])} et al.`;
}

function renderCitation(key, entry) {
  const dom = document.createElement('div');
  dom.className = 'cm-cite-preview';
  const strip = (s) => s.replace(/[{}]/g, '');
  if (!entry) {
    dom.classList.add('cm-cite-missing');
    dom.textContent = `No entry "${key}" in this project's .bib files`;
    return dom;
  }
  const title = document.createElement('div');
  title.className = 'cm-cite-title';
  title.textContent = strip(entry.title || '(no title)');
  const meta = document.createElement('div');
  meta.className = 'cm-cite-meta';
  meta.textContent = [shortAuthors(entry.author || ''), strip(entry.venue || ''), entry.year].filter(Boolean).join(' · ');
  const keyLine = document.createElement('div');
  keyLine.className = 'cm-cite-key';
  keyLine.textContent = `@${entry.type}{${entry.key}}`;
  dom.append(title, meta, keyLine);
  return dom;
}

// One hover source for both, so they never stack two tooltips at one spot.
// getBibEntries / getMacros are read at hover time: bib files and macros
// change while the editor stays mounted.
export function latexHoverPreviews({ getBibEntries, getMacros }) {
  return hoverTooltip(
    (view, pos) => {
      const line = view.state.doc.lineAt(pos);
      const cite = citeKeyAt(line.text, pos - line.from);
      if (cite) {
        const entry = getBibEntries().find((e) => e.key === cite.key);
        return {
          pos: line.from + cite.from,
          end: line.from + cite.to,
          above: true,
          create: () => ({ dom: renderCitation(cite.key, entry) }),
        };
      }
      const math = mathAt(view.state.doc, pos);
      if (!math || !math.tex.trim()) return null;
      const macros = { ...getMacros(), ...collectMacros(view.state.doc.toString()) };
      return { pos: math.from, end: math.to, above: true, create: () => ({ dom: renderMath(math, macros) }) };
    },
    { hoverTime: 350 }
  );
}

export const editorExtrasTheme = EditorView.theme({
  '.cm-sync-flash': { backgroundColor: 'rgba(255, 170, 0, 0.28)', transition: 'background-color 0.4s' },
  '.cm-math-preview': { padding: '8px 12px', maxWidth: '640px', overflowX: 'auto', fontSize: '1.05em' },
  '.cm-math-preview-error': { color: '#c0392b', fontSize: '12px', fontFamily: 'inherit' },
  '.cm-cite-preview': { padding: '8px 12px', maxWidth: '420px', fontSize: '13px', lineHeight: 1.4 },
  '.cm-cite-title': { fontWeight: 600 },
  '.cm-cite-meta': { opacity: 0.8, marginTop: '2px' },
  '.cm-cite-key': { opacity: 0.55, marginTop: '4px', fontFamily: 'ui-monospace, monospace', fontSize: '11px' },
  '.cm-cite-missing': { color: '#b35c00' },
});
