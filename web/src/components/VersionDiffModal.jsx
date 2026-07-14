import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { diffLines, collapseUnchanged, tooLargeToDiff } from '../lib/diff.js';

const HUNK_STYLE = {
  add: { background: 'rgba(60, 180, 90, 0.18)', color: 'var(--text)' },
  del: { background: 'rgba(214, 69, 69, 0.18)', color: 'var(--text)' },
  same: { color: 'var(--text-muted)' },
};

const HUNK_PREFIX = { add: '+', del: '-', same: ' ' };

// Read-only diff view between a saved version snapshot and the live
// project — no diff-apply, just inspection. Files not present on one side
// (added/removed since the snapshot) are treated as empty on that side, so
// the whole file shows as one big add/del block, same as a normal diff tool.
export default function VersionDiffModal({ projectId, version, liveFiles, onClose }) {
  const [snapshotPaths, setSnapshotPaths] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [selectedPath, setSelectedPath] = useState('');
  const [oldContent, setOldContent] = useState(null);
  const [newContent, setNewContent] = useState(null);
  const [contentError, setContentError] = useState('');
  const [loadingContent, setLoadingContent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .listSnapshotFiles(projectId, version.id)
      .then((paths) => {
        if (cancelled) return;
        setSnapshotPaths(paths);
      })
      .catch((err) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [projectId, version.id]);

  const liveTextPaths = useMemo(
    () => (liveFiles ?? []).filter((f) => f.type !== 'image' && f.type !== 'folder').map((f) => f.path),
    [liveFiles]
  );

  const allPaths = useMemo(() => {
    const set = new Set([...(snapshotPaths ?? []), ...liveTextPaths]);
    return Array.from(set).sort();
  }, [snapshotPaths, liveTextPaths]);

  useEffect(() => {
    if (selectedPath || allPaths.length === 0) return;
    setSelectedPath(allPaths[0]);
  }, [allPaths, selectedPath]);

  useEffect(() => {
    if (!selectedPath || !snapshotPaths) return;
    let cancelled = false;
    setLoadingContent(true);
    setContentError('');

    const oldPromise = snapshotPaths.includes(selectedPath)
      ? api.readSnapshotFile(projectId, version.id, selectedPath)
      : Promise.resolve('');
    const newPromise = liveTextPaths.includes(selectedPath)
      ? api.readFile(projectId, selectedPath)
      : Promise.resolve('');

    Promise.all([oldPromise, newPromise])
      .then(([oldText, newText]) => {
        if (cancelled) return;
        setOldContent(oldText);
        setNewContent(newText);
      })
      .catch((err) => !cancelled && setContentError(err.message))
      .finally(() => !cancelled && setLoadingContent(false));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, version.id, selectedPath, snapshotPaths]);

  const hunks = useMemo(() => {
    if (oldContent == null || newContent == null) return null;
    if (tooLargeToDiff(oldContent, newContent)) return 'too-large';
    const raw = diffLines(oldContent, newContent);
    if (!raw) return 'too-large';
    return collapseUnchanged(raw);
  }, [oldContent, newContent]);

  const inSnapshot = snapshotPaths?.includes(selectedPath);
  const inLive = liveTextPaths.includes(selectedPath);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 30,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 860,
          maxWidth: '92vw',
          height: '80vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--panel-bg)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <strong style={{ fontSize: 13 }}>
            Diff: {version.label || version.trigger} ({new Date(version.createdAt).toLocaleString()}) vs. current
          </strong>
          <select
            value={selectedPath}
            onChange={(e) => setSelectedPath(e.target.value)}
            style={{ fontSize: 12, marginLeft: 'auto' }}
          >
            {allPaths.length === 0 && <option value="">No files</option>}
            {allPaths.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button onClick={onClose} style={{ fontSize: 13 }}>
            Close
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 0' }}>
          {loadError && <p style={{ color: 'crimson', fontSize: 13, padding: '0 16px' }}>{loadError}</p>}
          {contentError && <p style={{ color: 'crimson', fontSize: 13, padding: '0 16px' }}>{contentError}</p>}
          {!loadError && selectedPath && !inSnapshot && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 16px' }}>
              This file didn't exist in this version — showing the whole file as added.
            </p>
          )}
          {!loadError && selectedPath && !inLive && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 16px' }}>
              This file no longer exists in the current project — showing the whole file as removed.
            </p>
          )}
          {loadingContent && <p style={{ fontSize: 13, padding: '0 16px' }}>Loading…</p>}
          {hunks === 'too-large' && (
            <p style={{ fontSize: 13, padding: '0 16px' }}>Files too large to diff.</p>
          )}
          {Array.isArray(hunks) && (
            <pre
              style={{
                margin: 0,
                padding: '0 16px',
                fontFamily: 'ui-monospace, monospace',
                fontSize: 12,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {hunks.map((h, i) =>
                h.type === 'collapsed' ? (
                  <div key={i} style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    ⋯ {h.count} unchanged lines
                  </div>
                ) : (
                  <div key={i} style={HUNK_STYLE[h.type]}>
                    {HUNK_PREFIX[h.type]} {h.text}
                  </div>
                )
              )}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
