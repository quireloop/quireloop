import { LANGUAGETOOL_URL } from '../config.js';

const MAX_TEXT_CHARS = 300_000;
const CHECK_TIMEOUT_MS = 60_000;

// Environments that are code or mathematics, not prose.
const SKIPPED_ENVIRONMENTS = new Set([
  'equation', 'equation*', 'align', 'align*', 'alignat', 'alignat*', 'gather', 'gather*', 'multline', 'multline*',
  'eqnarray', 'eqnarray*', 'displaymath', 'math', 'tikzpicture', 'verbatim', 'lstlisting', 'minted', 'algorithmic',
  'thebibliography', 'tabular', 'tabular*', 'tabularx', 'axis',
]);
// Commands whose arguments are keys, paths or settings. The value is what the
// reader would see there, so sentences around a citation still parse.
const SKIPPED_ARGUMENTS = {
  cite: '[1]', citep: '[1]', citet: '[1]', autocite: '[1]', parencite: '[1]', footcite: '',
  ref: '1', eqref: '(1)', autoref: 'Section 1', cref: 'Section 1', Cref: 'Section 1', pageref: '1',
  label: '', input: '', include: '', includegraphics: '', bibliography: '', bibliographystyle: '',
  usepackage: '', documentclass: '', vspace: '', hspace: '', setlength: '', url: 'example.org', begin: '', end: '',
  newcommand: '', renewcommand: '', definecolor: '', pagestyle: '', thispagestyle: '', setcounter: '',
};

// Turns LaTeX into LanguageTool's annotated form: a list of pieces that are
// either prose or markup, which together are exactly the source. Nothing is
// removed, so every position LanguageTool reports is a position in the file.
export function latexToAnnotation(source) {
  const pieces = [];
  const text = (value) => {
    if (!value) return;
    const last = pieces[pieces.length - 1];
    if (last && 'text' in last) last.text += value;
    else pieces.push({ text: value });
  };
  const markup = (value, interpretAs) => {
    if (!value) return;
    pieces.push(interpretAs === undefined ? { markup: value } : { markup: value, interpretAs });
  };

  let i = 0;
  const bodyStart = source.indexOf('\\begin{document}');
  if (bodyStart > 0) {
    markup(source.slice(0, bodyStart));
    i = bodyStart;
  }

  const skipBalanced = (start) => {
    const open = source[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    for (let at = start; at < source.length; at += 1) {
      if (source[at] === '\\') at += 1;
      else if (source[at] === open) depth += 1;
      else if (source[at] === close && --depth === 0) return at + 1;
    }
    return source.length;
  };

  while (i < source.length) {
    const ch = source[i];
    if (ch === '%') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end + 1;
      markup(source.slice(i, stop));
      i = stop;
    } else if (ch === '$') {
      const delimiter = source[i + 1] === '$' ? '$$' : '$';
      let end = i + delimiter.length;
      while (end < source.length && !source.startsWith(delimiter, end)) end += source[end] === '\\' ? 2 : 1;
      const stop = Math.min(end + delimiter.length, source.length);
      markup(source.slice(i, stop), 'x');
      i = stop;
    } else if (source.startsWith('\\[', i) || source.startsWith('\\(', i)) {
      const closer = source[i + 1] === '[' ? '\\]' : '\\)';
      const end = source.indexOf(closer, i);
      const stop = end === -1 ? source.length : end + 2;
      markup(source.slice(i, stop), 'x');
      i = stop;
    } else if (ch === '\\') {
      const command = /^\\([a-zA-Z]+)\*?/.exec(source.slice(i, i + 60));
      if (!command) {
        // \% \& \_ and similar print the character itself.
        markup(source.slice(i, i + 2), source[i + 1] && /[%&_#$]/.test(source[i + 1]) ? source[i + 1] : '');
        i += 2;
        continue;
      }
      const name = command[1];
      if (name === 'begin') {
        const env = /^\\begin\{([^}]+)\}/.exec(source.slice(i, i + 80))?.[1];
        if (env && SKIPPED_ENVIRONMENTS.has(env)) {
          const closer = `\\end{${env}}`;
          const end = source.indexOf(closer, i);
          const stop = end === -1 ? source.length : end + closer.length;
          markup(source.slice(i, stop), '\n\n');
          i = stop;
          continue;
        }
      }
      let end = i + command[0].length;
      if (name in SKIPPED_ARGUMENTS) {
        while (source[end] === '[' || source[end] === '{') end = skipBalanced(end);
        markup(source.slice(i, end), SKIPPED_ARGUMENTS[name]);
      } else {
        // \section{...}, \emph{...} and the like: the argument is prose, and
        // falls through to be read as text; only the command itself is markup.
        if (source[end] === '[') end = skipBalanced(end);
        if (source[end] === '{') end += 1;
        markup(source.slice(i, end));
      }
      i = end;
    } else if (ch === '{' || ch === '}') {
      markup(ch);
      i += 1;
    } else if (ch === '~') {
      markup(ch, ' ');
      i += 1;
    } else {
      const start = i;
      while (i < source.length && !'%$\\{}~'.includes(source[i])) i += 1;
      text(source.slice(start, i));
    }
  }
  return pieces;
}

// The prose alone, for pasting into a writing tool outside Quireloop.
export function latexToPlainText(source) {
  return latexToAnnotation(source)
    .map((piece) => ('text' in piece ? piece.text : piece.interpretAs ?? ''))
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function grammarEnabled() {
  return Boolean(LANGUAGETOOL_URL);
}

export async function checkGrammar(source, language = 'auto') {
  if (source.length > MAX_TEXT_CHARS) throw new Error('this file is too long to check in one go');
  const form = new URLSearchParams({
    data: JSON.stringify({ annotation: latexToAnnotation(source) }),
    language,
    // LaTeX spacing and line breaks aren't writing mistakes.
    disabledCategories: 'TYPOGRAPHY',
    disabledRules: 'WHITESPACE_RULE,UPPERCASE_SENTENCE_START,COMMA_PARENTHESIS_WHITESPACE',
    ...(language === 'auto' ? { preferredVariants: 'en-US' } : {}),
  });
  const res = await fetch(`${LANGUAGETOOL_URL}/v2/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`the grammar checker answered ${res.status}`);
  const body = await res.json();
  return (body.matches ?? []).map((m) => ({
    from: m.offset,
    to: m.offset + m.length,
    message: m.message,
    kind: m.rule?.issueType === 'misspelling' ? 'spelling' : 'grammar',
    replacements: (m.replacements ?? []).slice(0, 4).map((r) => r.value),
  }));
}
