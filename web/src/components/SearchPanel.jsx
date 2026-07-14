import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const DEBOUNCE_MS = 300;

export default function SearchPanel({ projectId, onJump }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null); // { matches, truncated } | null
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);

  function runSearch(q) {
    if (q.trim().length < 2) {
      setResult(null);
      setError(null);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    api
      .searchProject(projectId, q.trim())
      .then((res) => {
        if (requestIdRef.current !== requestId) return;
        setResult(res);
      })
      .catch((err) => {
        if (requestIdRef.current !== requestId) return;
        setError(err.message);
        setResult(null);
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false);
      });
  }

  function handleChange(e) {
    const value = e.target.value;
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value), DEBOUNCE_MS);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      runSearch(query);
    }
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const grouped = [];
  if (result?.matches?.length) {
    let currentFile = null;
    let currentGroup = null;
    for (const m of result.matches) {
      if (m.file !== currentFile) {
        currentFile = m.file;
        currentGroup = { file: m.file, matches: [] };
        grouped.push(currentGroup);
      }
      currentGroup.matches.push(m);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: 8 }}>
        <input
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Search project files…"
          style={{ width: '100%', fontSize: 13, padding: '4px 6px', boxSizing: 'border-box' }}
        />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 8px 8px' }}>
        {loading && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Searching…</div>}
        {error && <div style={{ fontSize: 12, color: 'crimson' }}>{error}</div>}
        {!loading && !error && result && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
            {result.matches.length} match{result.matches.length === 1 ? '' : 'es'}
            {result.truncated ? ' (showing first 200)' : ''}
          </div>
        )}
        {!loading && !error && result && result.matches.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No results</div>
        )}
        {grouped.map((group) => (
          <div key={group.file} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, wordBreak: 'break-all', marginBottom: 2 }}>{group.file}</div>
            {group.matches.map((m, i) => (
              <div
                key={i}
                onClick={() => onJump?.(m.file, m.line)}
                style={{
                  fontSize: 12,
                  padding: '3px 6px',
                  cursor: 'pointer',
                  borderRadius: 4,
                  display: 'flex',
                  gap: 6,
                }}
                title={m.preview}
              >
                <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{m.line}:</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.preview}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
