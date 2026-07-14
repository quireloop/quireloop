import { useState } from 'react';

const SEVERITY_COLOR = {
  error: 'crimson',
  warning: '#b8860b',
};

const SEVERITY_BG = {
  error: 'rgba(220,20,20,0.15)',
  warning: 'rgba(224,160,48,0.18)',
};

export default function CompileLogPanel({ log, success, problems, onClose, onJump }) {
  const [showRaw, setShowRaw] = useState(false);
  const list = problems ?? [];
  const errorCount = list.filter((p) => p.severity === 'error').length;
  const warningCount = list.filter((p) => p.severity === 'warning').length;

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
          {(errorCount > 0 || warningCount > 0) && (
            <span style={{ fontWeight: 400, fontSize: 12, marginLeft: 8, color: 'var(--text-muted)' }}>
              {errorCount > 0 ? `${errorCount} error${errorCount === 1 ? '' : 's'}` : ''}
              {errorCount > 0 && warningCount > 0 ? ', ' : ''}
              {warningCount > 0 ? `${warningCount} warning${warningCount === 1 ? '' : 's'}` : ''}
            </span>
          )}
        </strong>
        <button onClick={onClose}>Close</button>
      </div>

      {list.length > 0 && (
        <div style={{ margin: '8px 0' }}>
          {list.map((p, i) => (
            <div
              key={i}
              onClick={() => onJump?.(p.file, p.line)}
              style={{
                fontSize: 12,
                padding: '4px 6px',
                cursor: 'pointer',
                background: SEVERITY_BG[p.severity] ?? SEVERITY_BG.warning,
                color: SEVERITY_COLOR[p.severity] ?? SEVERITY_COLOR.warning,
                borderRadius: 4,
                marginBottom: 4,
              }}
            >
              <strong>
                {p.file}:{p.line}
              </strong>{' '}
              — {p.message}
            </div>
          ))}
        </div>
      )}

      {list.length === 0 && !success && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0' }}>
          No structured problems parsed from the log — see raw output below.
        </div>
      )}

      <button onClick={() => setShowRaw((v) => !v)} style={{ fontSize: 11 }}>
        {showRaw ? 'Hide raw log' : 'Show raw log'}
      </button>
      {showRaw && <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{log}</pre>}
    </div>
  );
}
