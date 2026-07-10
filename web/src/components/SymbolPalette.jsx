const SNIPPETS = [
  { label: 'itemize', text: '\\begin{itemize}\n  \\item \n\\end{itemize}' },
  { label: 'enumerate', text: '\\begin{enumerate}\n  \\item \n\\end{enumerate}' },
  { label: 'table', text: '\\begin{table}[ht]\n  \\centering\n  \\begin{tabular}{cc}\n    a & b \\\\\n  \\end{tabular}\n  \\caption{}\n\\end{table}' },
  { label: 'figure', text: '\\begin{figure}[ht]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{}\n  \\caption{}\n\\end{figure}' },
  { label: 'equation', text: '\\begin{equation}\n  \n\\end{equation}' },
];

const SYMBOLS = ['\\alpha', '\\beta', '\\gamma', '\\delta', '\\theta', '\\lambda', '\\sigma', '\\sum', '\\int', '\\infty', '\\partial', '\\nabla', '\\times', '\\leq', '\\geq', '\\approx'];

export default function SymbolPalette({ onInsert, onClose }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 40,
        right: 8,
        background: 'var(--panel-bg)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: 12,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 10,
        width: 260,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Insert</strong>
        <button onClick={onClose} style={{ fontSize: 12 }}>
          Close
        </button>
      </div>
      <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>Environments</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
        {SNIPPETS.map((s) => (
          <button key={s.label} onClick={() => onInsert(s.text)} style={{ fontSize: 12, padding: '3px 8px' }}>
            {s.label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>Symbols</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {SYMBOLS.map((s) => (
          <button key={s} onClick={() => onInsert(s + ' ')} style={{ fontSize: 12, padding: '3px 6px' }}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
