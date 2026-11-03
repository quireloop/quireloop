import { useEffect, useRef, useState } from 'react';
import { backupApi, linkApi } from '../api.js';

const STATE_LABEL = {
  online: 'Connected and syncing',
  offline: 'Offline. Keep working; changes sync when the server is back.',
  error: 'Sync problem',
  'reconnect-needed': 'Needs connecting again',
};

// Plain files in a folder of the person's choosing. Put it inside their OneDrive
// or Dropbox folder and those apps carry the copy off this computer.
function BackupFolder() {
  const [info, setInfo] = useState(null);
  const [path, setPath] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    backupApi
      .folder()
      .then((next) => {
        setInfo(next);
        setPath(next.path);
      })
      .catch(() => {});
  }, []);

  async function run(action) {
    setError('');
    try {
      setInfo(await action());
    } catch (err) {
      setError(err.message);
    }
  }

  if (!info) return null;
  return (
    <form
      style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => backupApi.setFolder(path.trim()));
      }}
    >
      <strong>Keep a backup copy in a folder</strong>
      <p style={{ margin: '4px 0', color: 'var(--text-muted)', fontSize: 12 }}>
        Your papers are copied here as ordinary files every few minutes. Choose a folder inside OneDrive or Dropbox to
        keep a copy in the cloud too.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/home/you/OneDrive/Quireloop backup"
          style={{ flex: 1, padding: 6 }}
        />
        <button type="submit">Save</button>
        {info.path && (
          <button type="button" onClick={() => run(backupApi.copyNow)}>
            Copy now
          </button>
        )}
      </div>
      {info.lastCopyAt && (
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
          Last copied {new Date(info.lastCopyAt).toLocaleString()}
        </div>
      )}
      {(error || info.lastError) && <p style={{ color: 'crimson', margin: '6px 0 0' }}>{error || info.lastError}</p>}
    </form>
  );
}

const panelStyle = {
  padding: 12,
  marginBottom: 16,
  background: 'var(--panel-bg)',
  borderRadius: 8,
  border: '1px solid var(--border)',
  fontSize: 13,
};

export default function ServerLinkPanel({ onChange }) {
  const [status, setStatus] = useState(null);
  const [url, setUrl] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [probe, setProbe] = useState(null);
  const [error, setError] = useState('');
  const lastUrl = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const next = await linkApi.status();
        if (!alive) return;
        setStatus(next);
        setDeviceName((name) => name || next.defaultDeviceName);
        // Papers appear as they arrive, so the list follows along.
        if (next.url || next.url !== lastUrl.current) onChangeRef.current?.(next);
        lastUrl.current = next.url;
      } catch {
        // this page's own server stopped; the next poll tries again
      }
    }
    poll();
    const timer = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  async function run(action) {
    setError('');
    try {
      return await action();
    } catch (err) {
      setError(err.message);
      return null;
    }
  }

  async function handleCheck(e) {
    e.preventDefault();
    const result = await run(() => linkApi.probe(url));
    if (!result) return;
    setProbe(result);
    if (result.trusted) await handleStart(result);
  }

  async function handleStart(checked = probe) {
    const started = await run(() => linkApi.start(checked.url, deviceName, checked.fingerprint));
    if (started) setStatus(await linkApi.status());
  }

  if (!status) return null;

  if (status.url) {
    return (
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
          <span>
            <strong>{STATE_LABEL[status.state] ?? 'Connecting…'}</strong>
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {status.url}
              {status.lastSyncAt && ` · last synced ${new Date(status.lastSyncAt).toLocaleTimeString()}`}
            </div>
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => run(linkApi.syncNow)}>Sync now</button>
            <button onClick={() => run(linkApi.disconnect)}>Disconnect</button>
          </span>
        </div>
        {status.lastError && <p style={{ color: 'crimson', margin: '8px 0 0' }}>{status.lastError}</p>}
        {status.notices.map((n) => (
          <p key={n.message} style={{ margin: '8px 0 0' }}>
            {n.message}
          </p>
        ))}
        {error && <p style={{ color: 'crimson', margin: '8px 0 0' }}>{error}</p>}
        <BackupFolder />
      </div>
    );
  }

  if (status.pending) {
    return (
      <div style={panelStyle}>
        <strong>Approve this computer on the server</strong>
        {status.pending.error ? (
          <p style={{ color: 'crimson' }}>{status.pending.error}</p>
        ) : (
          <p>
            <a href={status.pending.verifyUrl} target="_blank" rel="noreferrer">
              Open the server
            </a>
            , sign in, and check it shows <code>{status.pending.userCode}</code>.
          </p>
        )}
        <button onClick={() => run(linkApi.cancel).then(() => setProbe(null))}>Cancel</button>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <strong>Work with a server</strong>
      <p style={{ margin: '6px 0', color: 'var(--text-muted)' }}>
        Keep a copy of your server papers on this computer. Edit with or without internet, and everything syncs by
        itself.
      </p>
      <form onSubmit={handleCheck} style={{ display: 'grid', gap: 8 }}>
        <input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setProbe(null);
          }}
          placeholder="https://your-server/quireloop"
          style={{ padding: 8 }}
          required
        />
        <input
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          placeholder="Name for this computer"
          style={{ padding: 8 }}
        />
        {probe && !probe.trusted ? (
          <div>
            <p style={{ margin: '0 0 6px' }}>
              This server uses its own certificate, which your computer can't verify. Continue only if this is your
              server. If its certificate later changes, sync stops until you connect again.
            </p>
            <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{probe.fingerprint}</code>
            <div style={{ marginTop: 8 }}>
              <button type="button" className="primary-button" onClick={() => handleStart()}>
                Trust and continue
              </button>
            </div>
          </div>
        ) : (
          <button type="submit" className="primary-button" style={{ justifySelf: 'start' }}>
            Connect
          </button>
        )}
      </form>
      {error && <p style={{ color: 'crimson', margin: '8px 0 0' }}>{error}</p>}
      <BackupFolder />
    </div>
  );
}
