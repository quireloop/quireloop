const ERROR_LINE_RE = /^(?:\.\/)?([^\s:][^:\n]*\.(?:tex|sty|cls)):(\d+):\s*(.+)$/gm;

function parseErrors(log) {
  const matches = [];
  for (const m of log.matchAll(ERROR_LINE_RE)) {
    matches.push({ file: m[1], line: Number(m[2]), message: m[3] });
  }
  return matches;
}

export default function CompileLogPanel({ log, success, onClose, onJump }) {
  const errors = success ? [] : parseErrors(log);

  return (
    <div
      style={{
        borderTop: '1px solid var(--border)',
        maxHeight: '35%',
        overflow: 'auto',
        background: success ? 'rgba(0,180,0,0.08)' : 'rgba(220,20,20,0.08)',
        padding: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ color: success ? 'green' : 'crimson' }}>
          {success ? 'Compiled successfully' : 'Compile failed'}
        </strong>
        <button onClick={onClose}>Close</button>
      </div>

      {errors.length > 0 && (
        <div style={{ margin: '8px 0' }}>
          {errors.map((e, i) => (
            <div
              key={i}
              onClick={() => onJump?.(e.file, e.line)}
              style={{
                fontSize: 12,
                padding: '4px 6px',
                cursor: 'pointer',
                background: 'rgba(220,20,20,0.15)',
                borderRadius: 4,
                marginBottom: 4,
              }}
            >
              <strong>
                {e.file}:{e.line}
              </strong>{' '}
              — {e.message}
            </div>
          ))}
        </div>
      )}

      <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{log}</pre>
    </div>
  );
}
