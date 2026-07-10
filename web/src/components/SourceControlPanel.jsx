import { useEffect, useState } from 'react';
import { api } from '../api.js';

const STATUS_LABELS = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  '??': 'Untracked',
};

function StatusBadge({ status }) {
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span
      title={label}
      style={{
        fontSize: 11,
        fontFamily: 'ui-monospace, monospace',
        color: 'var(--text-muted)',
        border: '1px solid var(--border)',
        borderRadius: 3,
        padding: '0 4px',
        flexShrink: 0,
      }}
    >
      {status}
    </span>
  );
}

export default function SourceControlPanel({ projectId, beforeAction }) {
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showRemoteForm, setShowRemoteForm] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteToken, setRemoteToken] = useState('');

  async function refresh() {
    try {
      setStatus(await api.gitStatus(projectId));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function runAction(fn) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await beforeAction?.();
      await fn();
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleCommit() {
    runAction(async () => {
      const result = await api.gitCommit(projectId, message);
      setMessage('');
      setNotice(result.committed ? 'Committed.' : 'Nothing to commit.');
    });
  }

  function handlePush() {
    runAction(async () => {
      await api.gitPush(projectId);
      setNotice('Pushed.');
    });
  }

  function handlePull() {
    runAction(async () => {
      await api.gitPull(projectId);
      setNotice('Pulled.');
    });
  }

  function handleSaveRemote(e) {
    e.preventDefault();
    if (!remoteUrl.trim()) return;
    runAction(async () => {
      await api.setGitRemote(projectId, remoteUrl.trim(), remoteToken.trim());
      setShowRemoteForm(false);
      setRemoteUrl('');
      setRemoteToken('');
      setNotice('Remote saved.');
    });
  }

  if (!status) return <div style={{ padding: 12, fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>;

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, overflowY: 'auto' }}>
      <div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          On <strong>{status.branch}</strong>
          {status.remote && status.hasUpstream && (
            <span>
              {' '}
              — {status.ahead > 0 && `${status.ahead} to push`}
              {status.ahead > 0 && status.behind > 0 && ', '}
              {status.behind > 0 && `${status.behind} to pull`}
              {status.ahead === 0 && status.behind === 0 && 'up to date'}
            </span>
          )}
        </div>
        {status.remote ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <code style={{ fontSize: 11, wordBreak: 'break-all', color: 'var(--text-muted)' }}>{status.remote}</code>
            <button onClick={() => setShowRemoteForm((v) => !v)} style={{ fontSize: 11, flexShrink: 0 }}>
              Change
            </button>
          </div>
        ) : (
          <button onClick={() => setShowRemoteForm((v) => !v)} style={{ fontSize: 12, marginTop: 4 }}>
            Set remote (GitHub, the hosted editor, …)
          </button>
        )}
      </div>

      {showRemoteForm && (
        <form
          onSubmit={handleSaveRemote}
          style={{
            display: 'grid',
            gap: 6,
            padding: 8,
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: 'var(--panel-bg)',
          }}
        >
          <input
            value={remoteUrl}
            onChange={(e) => setRemoteUrl(e.target.value)}
            placeholder="https://github.com/you/paper.git"
            style={{ padding: 6, fontSize: 12 }}
            required
          />
          <input
            value={remoteToken}
            onChange={(e) => setRemoteToken(e.target.value)}
            placeholder="Access token (leave blank if public)"
            type="password"
            style={{ padding: 6, fontSize: 12 }}
          />
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            A GitHub/GitLab personal access token, or an the hosted editor git token — used as the username, no password
            needed. Stored locally for this project only, never committed.
          </div>
          <button type="submit" disabled={busy} style={{ fontSize: 12, justifySelf: 'start' }}>
            Save
          </button>
        </form>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={handlePull} disabled={busy || !status.remote} style={{ flex: 1, fontSize: 12 }}>
          Pull
        </button>
        <button onClick={handlePush} disabled={busy || !status.remote} style={{ flex: 1, fontSize: 12 }}>
          Push
        </button>
        <button onClick={refresh} disabled={busy} title="Refresh status" style={{ fontSize: 12 }}>
          ↻
        </button>
      </div>

      {error && <p style={{ color: 'crimson', margin: 0, fontSize: 12 }}>{error}</p>}
      {notice && !error && <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 12 }}>{notice}</p>}

      <div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Commit message"
          rows={2}
          style={{ width: '100%', padding: 6, fontSize: 12, resize: 'vertical', fontFamily: 'inherit' }}
        />
        <button
          onClick={handleCommit}
          disabled={busy || status.files.length === 0}
          style={{ width: '100%', marginTop: 6, padding: 6, fontSize: 12 }}
        >
          Commit {status.files.length > 0 ? `(${status.files.length})` : ''}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {status.files.length === 0 && <p style={{ color: 'var(--text-muted)', margin: 0 }}>No changes.</p>}
        {status.files.map((f) => (
          <div key={f.path} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <StatusBadge status={f.status} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
