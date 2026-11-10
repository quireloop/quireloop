import { promptDialog } from '../lib/dialog.js';

// The commands people reach for most, one click each, above the editor. A
// command that needs a package adds it to the preamble too (`needs`), so
// pressing Highlight works without first knowing about soul and xcolor.

const SECTIONS = [
  ['section', 'Section'],
  ['subsection', 'Subsection'],
  ['subsubsection', 'Subsubsection'],
  ['paragraph', 'Paragraph'],
];

const COLORS = ['red', 'blue', 'teal', 'orange', 'violet', 'gray'];

const SYMBOLS = [
  ['\\alpha', 'α'], ['\\beta', 'β'], ['\\gamma', 'γ'], ['\\delta', 'δ'], ['\\epsilon', 'ε'], ['\\theta', 'θ'],
  ['\\lambda', 'λ'], ['\\mu', 'μ'], ['\\pi', 'π'], ['\\sigma', 'σ'], ['\\phi', 'φ'], ['\\omega', 'ω'],
  ['\\sum', '∑'], ['\\prod', '∏'], ['\\int', '∫'], ['\\infty', '∞'], ['\\partial', '∂'], ['\\nabla', '∇'],
  ['\\times', '×'], ['\\cdot', '·'], ['\\pm', '±'], ['\\leq', '≤'], ['\\geq', '≥'], ['\\neq', '≠'],
  ['\\approx', '≈'], ['\\in', '∈'], ['\\subseteq', '⊆'], ['\\cup', '∪'], ['\\cap', '∩'], ['\\to', '→'],
  ['\\Rightarrow', '⇒'], ['\\forall', '∀'], ['\\exists', '∃'], ['\\mathbb{R}', 'ℝ'],
];

// Packages a paper most often needs, with what each is for.
export const COMMON_PACKAGES = [
  ['amsmath', 'Equations: align, matrices, \\text'],
  ['amssymb', 'Extra math symbols such as \\mathbb'],
  ['graphicx', 'Images with \\includegraphics'],
  ['booktabs', 'Clean tables: \\toprule, \\midrule'],
  ['hyperref', 'Clickable links and references'],
  ['xcolor', 'Coloured text'],
  ['soul', 'Highlighted text with \\hl'],
  ['geometry', 'Page margins'],
  ['multirow', 'Table cells spanning rows'],
  ['subcaption', 'Sub-figures side by side'],
  ['algorithm2e', 'Algorithms and pseudocode'],
  ['listings', 'Program code'],
  ['siunitx', 'Numbers and units'],
  ['cleveref', 'Smart references: \\cref'],
  ['natbib', 'Author-year citations'],
  ['tikz', 'Drawings and diagrams'],
];

const ZOOM_MIN = 10;
const ZOOM_MAX = 28;

function tabular(rows, cols) {
  const header = Array.from({ length: cols }, (_, i) => `Header ${i + 1}`).join(' & ');
  const row = Array.from({ length: cols }, () => ' ').join(' & ');
  const body = Array.from({ length: Math.max(rows - 1, 0) }, () => `    ${row} \\\\`).join('\n');
  return [
    '\\begin{table}[htbp]',
    '  \\centering',
    `  \\begin{tabular}{${'l'.repeat(cols)}}`,
    '    \\toprule',
    `    ${header} \\\\`,
    '    \\midrule',
    body,
    '    \\bottomrule',
    '  \\end{tabular}',
    '  \\caption{Caption}',
    '  \\label{tab:label}',
    '\\end{table}',
  ].join('\n');
}

function Group({ label, children }) {
  return (
    <div className="insert-group" role="group" aria-label={label}>
      {children}
    </div>
  );
}

function Tool({ title, onClick, children, disabled }) {
  return (
    <button className="insert-tool" title={title} aria-label={title} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

// A <select> used as a menu: picking an entry runs it and the box goes back
// to its label.
function Pick({ label, title, options, onPick, disabled }) {
  return (
    <select
      className="insert-pick"
      value=""
      title={title}
      aria-label={title}
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value);
        e.target.value = '';
      }}
    >
      <option value="">{label}</option>
      {options.map(([value, text]) => (
        <option key={value} value={value}>
          {text}
        </option>
      ))}
    </select>
  );
}

export default function InsertToolbar({ editor, readOnly, images, fontSize, onFontSize, onNeedPackage }) {
  const ed = () => editor.current;
  const wrap = (before, after, placeholder, needs = []) => async () => {
    for (const pkg of needs) await onNeedPackage(pkg);
    ed()?.wrapSelection(before, after, placeholder);
  };
  const block = (text, select, needs = []) => async () => {
    for (const pkg of needs) await onNeedPackage(pkg);
    ed()?.insertBlock(text, select);
  };

  async function insertTable() {
    const answer = await promptDialog({
      title: 'Insert a table',
      message: 'Rows × columns, header row included.',
      defaultValue: '3 x 3',
      confirmLabel: 'Insert',
    });
    const match = answer?.match(/(\d+)\s*[x×*,\s]\s*(\d+)/i);
    if (!match) return;
    const rows = Math.min(Math.max(Number(match[1]), 1), 50);
    const cols = Math.min(Math.max(Number(match[2]), 1), 20);
    await onNeedPackage('booktabs');
    ed()?.insertBlock(tabular(rows, cols), 'Header 1');
  }

  async function insertFigure(path) {
    await onNeedPackage('graphicx');
    const label = path.replace(/^.*\//, '').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    ed()?.insertBlock(
      [
        '\\begin{figure}[htbp]',
        '  \\centering',
        `  \\includegraphics[width=0.8\\linewidth]{${path === '__none__' ? 'figures/your-image' : path}}`,
        '  \\caption{Caption}',
        `  \\label{fig:${path === '__none__' ? 'label' : label}}`,
        '\\end{figure}',
      ].join('\n'),
      'Caption'
    );
  }

  async function addPackage(name) {
    let pkg = name;
    if (name === '__other__') {
      pkg = (await promptDialog({ title: 'Add a package', placeholder: 'Package name, e.g. enumitem', confirmLabel: 'Add' }))?.trim();
      if (!pkg || !/^[A-Za-z0-9-]+$/.test(pkg)) return;
    }
    await onNeedPackage(pkg, { announce: true });
  }

  const zoom = (
    <Group label="Text size">
      <Tool title="Smaller text" onClick={() => onFontSize(Math.max(ZOOM_MIN, fontSize - 1))} disabled={fontSize <= ZOOM_MIN}>
        A−
      </Tool>
      <button className="insert-tool insert-zoom" title="Reset text size" onClick={() => onFontSize(14)}>
        {Math.round((fontSize / 14) * 100)}%
      </button>
      <Tool title="Larger text" onClick={() => onFontSize(Math.min(ZOOM_MAX, fontSize + 1))} disabled={fontSize >= ZOOM_MAX}>
        A+
      </Tool>
    </Group>
  );

  if (readOnly) return <div className="insert-toolbar">{zoom}</div>;

  return (
    <div className="insert-toolbar">
      <Group label="Text formatting">
        <Tool title="Bold" onClick={wrap('\\textbf{', '}', 'bold text')}>
          <b>B</b>
        </Tool>
        <Tool title="Italic" onClick={wrap('\\textit{', '}', 'italic text')}>
          <i>I</i>
        </Tool>
        <Tool title="Underline" onClick={wrap('\\underline{', '}', 'underlined text')}>
          <u>U</u>
        </Tool>
        <Tool title="Highlight (adds soul and xcolor)" onClick={wrap('\\hl{', '}', 'highlighted text', ['xcolor', 'soul'])}>
          <span className="insert-highlight">H</span>
        </Tool>
        <Pick
          label="Colour"
          title="Coloured text (adds xcolor)"
          options={COLORS.map((c) => [c, c])}
          onPick={(c) => wrap(`\\textcolor{${c}}{`, '}', 'coloured text', ['xcolor'])()}
        />
        <Pick
          label="Align"
          title="Align the selected text"
          options={[
            ['flushleft', 'Left'],
            ['center', 'Centre'],
            ['flushright', 'Right'],
          ]}
          onPick={(env) => wrap(`\\begin{${env}}\n`, `\n\\end{${env}}`, 'text')()}
        />
      </Group>

      <Group label="Structure">
        <Pick label="Heading" title="Insert a heading" options={SECTIONS} onPick={(cmd) => wrap(`\\${cmd}{`, '}', 'Title')()} />
        <Tool title="Bulleted list" onClick={block('\\begin{itemize}\n  \\item First point\n  \\item \n\\end{itemize}', 'First point')}>
          •≡
        </Tool>
        <Tool title="Numbered list" onClick={block('\\begin{enumerate}\n  \\item First step\n  \\item \n\\end{enumerate}', 'First step')}>
          1≡
        </Tool>
        <Tool title="Footnote" onClick={wrap('\\footnote{', '}', 'footnote text')}>
          fn
        </Tool>
        <Tool title="Citation" onClick={wrap('\\cite{', '}', 'key')}>
          [1]
        </Tool>
        <Tool title="Reference to a label" onClick={wrap('\\ref{', '}', 'sec:label')}>
          ref
        </Tool>
        <Tool title="Label" onClick={wrap('\\label{', '}', 'sec:label')}>
          lbl
        </Tool>
      </Group>

      <Group label="Math">
        <Tool title="Inline math" onClick={wrap('$', '$', 'x')}>
          $x$
        </Tool>
        <Tool title="Numbered equation" onClick={block('\\begin{equation}\n  E = mc^2\n  \\label{eq:label}\n\\end{equation}', 'E = mc^2')}>
          (1)
        </Tool>
        <Tool
          title="Aligned equations (adds amsmath)"
          onClick={block('\\begin{align}\n  a &= b + c \\\\\n  d &= e + f\n\\end{align}', 'a &= b + c', ['amsmath'])}
        >
          a=
        </Tool>
        <Tool title="Fraction" onClick={wrap('\\frac{', '}{denominator}', 'numerator')}>
          ½
        </Tool>
        <Tool
          title="Matrix (adds amsmath)"
          onClick={block('\\[\n  \\begin{bmatrix}\n    a & b \\\\\n    c & d\n  \\end{bmatrix}\n\\]', 'a', ['amsmath'])}
        >
          [⋮]
        </Tool>
        <Pick
          label="Symbol"
          title="Insert a math symbol"
          options={SYMBOLS.map(([cmd, glyph]) => [cmd, `${glyph}  ${cmd}`])}
          onPick={async (cmd) => {
            if (cmd === '\\mathbb{R}') await onNeedPackage('amssymb');
            ed()?.insertAtCursor(cmd);
          }}
        />
      </Group>

      <Group label="Floats and packages">
        <Tool title="Table (adds booktabs)" onClick={insertTable}>
          ⊞ Table
        </Tool>
        <Pick
          label="Figure"
          title="Figure with an image from this project (adds graphicx)"
          options={[...images.map((p) => [p, p]), ['__none__', 'Empty figure, add the image later']]}
          onPick={insertFigure}
        />
        <Pick
          label="+ Package"
          title="Add a package to the main file's preamble"
          options={[...COMMON_PACKAGES.map(([name, what]) => [name, `${name} — ${what}`]), ['__other__', 'Another package…']]}
          onPick={addPackage}
        />
      </Group>

      {zoom}
    </div>
  );
}
