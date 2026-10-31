// Finds the text between a delimiter pair starting at `openIdx` (a `{` or
// `"`), counting nested braces so "{DNA}" inside a title doesn't look like
// the field's own closing delimiter.
function extractDelimited(text, openIdx) {
  const opener = text[openIdx];
  const closer = opener === '{' ? '}' : '"';
  let depth = 0;
  let i = openIdx;
  for (; i < text.length; i++) {
    if (opener === '{') {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    } else if (text[i] === '"' && i !== openIdx) {
      break;
    }
  }
  return { value: text.slice(openIdx + 1, i), end: i };
}

// A field's value, braced, quoted or bare (`year = 2024`). The name is
// anchored to a field boundary so `title` doesn't match inside `booktitle`.
function extractField(entryBody, name) {
  const fieldMatch = entryBody.match(new RegExp(`(?:^|[,\\s])${name}\\s*=\\s*`, 'i'));
  if (!fieldMatch) return '';
  const delimIdx = fieldMatch.index + fieldMatch[0].length;
  const opener = entryBody[delimIdx];
  if (opener !== '{' && opener !== '"') {
    return (entryBody.slice(delimIdx).match(/^[^,}\s]+/)?.[0] ?? '').trim();
  }
  return extractDelimited(entryBody, delimIdx).value.replace(/\s+/g, ' ').trim();
}

// Minimal BibTeX extraction for citation autocomplete and the \cite hover
// card — not a full parser, just key, title, authors, year and venue. Braces are
// counted rather than regex-matched so entries (and fields within them)
// with nested braces — common in titles, e.g. "{DNA} sequencing" or
// "a {GPT-4} study" — don't get truncated at the first inner `}`.
export function parseBibEntries(text) {
  const entries = [];
  const entryStart = /@(\w+)\s*\{\s*([^,\s}]+)\s*,/g;
  let m;
  while ((m = entryStart.exec(text))) {
    const [, type, key] = m;
    const openBrace = text.indexOf('{', m.index);
    const { end } = extractDelimited(text, openBrace);
    const body = text.slice(entryStart.lastIndex, end);
    entries.push({
      type,
      key,
      title: extractField(body, 'title'),
      author: extractField(body, 'author'),
      year: extractField(body, 'year'),
      venue: extractField(body, 'journal') || extractField(body, 'booktitle'),
    });
    entryStart.lastIndex = end + 1;
  }
  return entries;
}
