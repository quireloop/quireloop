const SECTION_RE = /^\s*\\(chapter|section|subsection|subsubsection)\*?\{([^}]*)\}/;

const LEVELS = { chapter: 0, section: 1, subsection: 2, subsubsection: 3 };

export function buildOutline(text) {
  const lines = text.split('\n');
  const entries = [];
  lines.forEach((line, i) => {
    const m = line.match(SECTION_RE);
    if (m) {
      entries.push({ level: LEVELS[m[1]], title: m[2], line: i + 1 });
    }
  });
  return entries;
}

export function countWords(text) {
  // Strip LaTeX comments and commands for a closer approximation of prose word count.
  const stripped = text
    .replace(/%.*$/gm, '')
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{[^}]*\})?/g, ' ')
    .replace(/[{}$]/g, ' ');
  const words = stripped.trim().split(/\s+/).filter(Boolean);
  return words.length;
}
