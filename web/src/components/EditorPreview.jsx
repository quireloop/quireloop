import { useEffect, useState } from 'react';

// A hand-built mockup of the real editor — not a screenshot, but every
// element (toolbar, file tree, code colors, PDF pane) mirrors the actual
// ProjectView/Editor/PdfViewer so a first-time visitor sees, honestly,
// roughly what they'll get.
const CODE_LINES = [
  [{ t: '\\documentclass', c: '#c586c0' }, { t: '{article}', c: '#d4d4d4' }],
  [{ t: '\\usepackage', c: '#c586c0' }, { t: '{amsmath}', c: '#d4d4d4' }],
  [],
  [{ t: '\\title', c: '#c586c0' }, { t: '{Attention Is All You Need}', c: '#ce9178' }],
  [{ t: '\\author', c: '#c586c0' }, { t: '{A. Researcher}', c: '#ce9178' }],
  [],
  [{ t: '\\begin', c: '#c586c0' }, { t: '{document}', c: '#4ec9b0' }],
  [{ t: '\\maketitle', c: '#c586c0' }],
  [],
  [{ t: '\\begin', c: '#c586c0' }, { t: '{abstract}', c: '#4ec9b0' }],
  [{ t: 'We propose a novel architecture based', c: '#9cdcfe' }],
  [{ t: 'entirely on attention mechanisms…', c: '#9cdcfe' }],
  [{ t: '\\end', c: '#c586c0' }, { t: '{abstract}', c: '#4ec9b0' }],
  [],
  [{ t: '\\section', c: '#c586c0' }, { t: '{Introduction}', c: '#d4d4d4' }],
  [{ t: 'Recent advances in sequence modeling', c: '#9cdcfe' }],
];

const AVATARS = [
  { initials: 'AR', color: '#e7a13a' },
  { initials: 'MK', color: '#6a8fd6' },
  { initials: 'SP', color: '#6fbf73' },
];

export default function EditorPreview() {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    setNarrow(mq.matches);
    const handler = (e) => setNarrow(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return (
    <div
      style={{
        maxWidth: 920,
        margin: '0 auto',
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid var(--border)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 14px',
          background: '#252526',
          borderBottom: '1px solid #3a3a3a',
        }}
      >
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57' }} />
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e' }} />
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840' }} />
        </div>
        <span
          style={{
            color: '#ccc',
            fontSize: 12,
            fontFamily: 'ui-monospace, monospace',
            marginLeft: 4,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
          }}
        >
          {narrow ? 'paper.tex' : 'attention-is-all-you-need.tex'}
        </span>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            marginLeft: 12,
            fontSize: 11,
            color: '#7fd88f',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#7fd88f',
              boxShadow: '0 0 6px #7fd88f',
            }}
          />
          {!narrow && 'Live'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {AVATARS.map((a) => (
            <span
              key={a.initials}
              title={a.initials}
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: a.color,
                color: '#1a1a1a',
                fontSize: 9,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1.5px solid #252526',
                marginLeft: -6,
              }}
            >
              {a.initials}
            </span>
          ))}
          {!narrow && (
            <span style={{ fontSize: 11, color: '#999', marginLeft: 8, border: '1px solid #444', borderRadius: 4, padding: '3px 8px' }}>
              Compile
            </span>
          )}
        </div>
      </div>

      {/* Split: code + pdf — narrow screens drop the code pane rather than
          cramming both into an illegible sliver each. */}
      <div style={{ display: 'flex', minHeight: 320 }}>
        {!narrow && (
          <>
            <div style={{ flex: 1, background: '#1e1e1e', padding: '14px 0', fontFamily: 'ui-monospace, "SF Mono", monospace', fontSize: 12.5 }}>
              {CODE_LINES.map((line, i) => (
                <div key={i} style={{ display: 'flex', padding: '1.5px 14px' }}>
                  <span style={{ color: '#5a5a5a', width: 20, flexShrink: 0, userSelect: 'none' }}>{i + 1}</span>
                  <span>
                    {line.length === 0 ? ' ' : line.map((tok, j) => <span key={j} style={{ color: tok.c }}>{tok.t}</span>)}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ width: 1, background: '#3a3a3a' }} />
          </>
        )}
        <div style={{ flex: 1, background: '#525252', padding: 20, display: 'flex', justifyContent: 'center' }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 320, padding: '28px 24px', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 700, textAlign: 'center', color: '#111' }}>
              Attention Is All You Need
            </div>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 10, textAlign: 'center', color: '#555', marginTop: 6 }}>
              A. Researcher
            </div>
            <div style={{ marginTop: 20, display: 'grid', gap: 6 }}>
              {[92, 100, 88, 96, 60].map((w, i) => (
                <div key={i} style={{ height: 6, width: `${w}%`, background: '#d8d8d8', borderRadius: 2 }} />
              ))}
            </div>
            <div style={{ marginTop: 18, fontFamily: 'Georgia, serif', fontSize: 11, fontWeight: 700, color: '#111' }}>
              1&nbsp;&nbsp;Introduction
            </div>
            <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
              {[100, 94, 98, 40].map((w, i) => (
                <div key={i} style={{ height: 6, width: `${w}%`, background: '#e4e4e4', borderRadius: 2 }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
