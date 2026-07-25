import { useState } from 'react';

const SEVERITY_COLOR = {
  error: 'crimson',
  warning: '#b8860b',
};

const SEVERITY_BG = {
  error: 'rgba(220,20,20,0.15)',
  warning: 'rgba(224,160,48,0.18)',
};

// Docked status strip, collapsed by default — only auto-expands when a
// compile actually has something to say (errors/warnings). A clean compile
// just updates the one-line status text without opening anything, so
// clicking Compile repeatedly doesn't keep shoving the editor content out
// of the way (the hosted editor's log panel behaves the same way).
export default function CompileLogPanel({ log, success, problems, expanded, onToggleExpanded, onClose, onJump }) {
  const [showRaw, setShowRaw] = useState(false);
  const list = problems ?? [];
  const errorCount = list.filter((p) => p.severity === 'error').length;
  const warningCount = list.filter((p) => p.severity === 'warning').length;

  return (
    <div
      style={{
        borderTop: '1px solid var(--border)',
        maxHeight: expanded ? '35%' : 32,
        overflow: 'auto',
        background: success ? 'rgba(0,180,0,0.06)' : 'rgba(220,20,20,0.06)',
        flexShrink: 0,
        transition: 'max-height 0.15s ease',
      }}
    >
      <div
        onClick={onToggleExpanded}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 8px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{expanded ? '▾' : '▸'}</span>
          <strong style={{ color: success ? 'green' : 'crimson' }}>
            {success ? 'Compiled successfully' : 'Compile failed'}
          </strong>
          {(errorCount > 0 || warningCount > 0) && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {errorCount > 0 ? `${errorCount} error${errorCount === 1 ? '' : 's'}` : ''}
              {errorCount > 0 && warningCount > 0 ? ', ' : ''}
              {warningCount > 0 ? `${warningCount} warning${warningCount === 1 ? '' : 's'}` : ''}
            </span>
          )}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          style={{ fontSize: 11, padding: '2px 6px' }}
        >
          Dismiss
        </button>
      </div>

      {expanded && (
        <div style={{ padding: '0 8px 8px' }}>
          {list.length > 0 && (
            <div style={{ margin: '4px 0' }}>
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
            <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0' }}>
              No structured problems parsed from the log — see raw output below.
            </div>
          )}

          <button onClick={() => setShowRaw((v) => !v)} style={{ fontSize: 11 }}>
            {showRaw ? 'Hide raw log' : 'Show raw log'}
          </button>
          {showRaw && <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{log}</pre>}
        </div>
      )}
    </div>
  );
}
