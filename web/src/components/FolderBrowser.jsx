import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Browses the folders the server operator has made available and opens one as
// a project, edited in place. The server is the authority on what's reachable
// (QUIRELOOP_LIBRARY_DIRS); this only ever navigates to paths the server
// itself just handed back, so there's no path building here to get wrong.
export default function FolderBrowser({ roots, onClose, onOpened }) {
  const [listing, setListing] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function go(path) {
    setError('');
    try {
      const next = await api.browseLibrary(path);
      setListing(next);
      // Default the project name to the folder's own name, which is almost
      // always what the user wants, while still leaving it editable.
      setName(next.path.split('/').filter(Boolean).pop() ?? '');
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    if (roots.length === 1) go(roots[0].path);
  }, []);

  async function handleOpen() {
    if (!listing) return;
    setBusy(true);
    setError('');
    try {
      onOpened(await api.openFolder(listing.path, name.trim()));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const canOpen = listing && listing.texFiles.length > 0;

  return (
    <div
      style={{
        padding: 16,
        marginBottom: 24,
        background: 'var(--panel-bg)',
        borderRadius: 8,
        border: '1px solid var(--border)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong>Open a folder on the server</strong>
        <button type="button" onClick={onClose} style={{ fontSize: 13 }}>
          Close
        </button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
        Pick the folder holding your <code>.tex</code> files. Quireloop edits it in place — nothing is copied, and
        the compiled PDF lands in a <code>build/</code> folder next to your sources.
      </p>

      {!listing && (
        <div style={{ display: 'grid', gap: 6 }}>
          {roots.map((root) => (
            <button key={root.path} type="button" onClick={() => go(root.path)} style={{ textAlign: 'left', padding: 8 }}>
              📁 {root.label}
              <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 8 }}>{root.path}</span>
            </button>
          ))}
        </div>
      )}

      {listing && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, wordBreak: 'break-all' }}>
            {listing.path}
          </div>
          <div
            style={{
              maxHeight: 220,
              overflowY: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 6,
              marginBottom: 10,
            }}
          >
            {listing.parent && (
              <button
                type="button"
                onClick={() => go(listing.parent)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: 8, border: 'none' }}
              >
                ↰ ..
              </button>
            )}
            {listing.folders.map((folder) => (
              <button
                key={folder.path}
                type="button"
                onClick={() => go(folder.path)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: 8, border: 'none' }}
              >
                📁 {folder.name}
              </button>
            ))}
            {listing.folders.length === 0 && !listing.parent && (
              <div style={{ padding: 8, fontSize: 13, color: 'var(--text-muted)' }}>No subfolders.</div>
            )}
          </div>

          <div style={{ fontSize: 13, marginBottom: 10, color: canOpen ? 'inherit' : 'var(--text-muted)' }}>
            {canOpen
              ? `${listing.texFiles.length} LaTeX file${listing.texFiles.length === 1 ? '' : 's'} here: ${listing.texFiles
                  .slice(0, 6)
                  .join(', ')}${listing.texFiles.length > 6 ? '…' : ''}`
              : 'No .tex files in this folder — open one of its subfolders instead.'}
            {listing.isGitRepo && ' · already a git repo, so Source Control will work'}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              style={{ flex: 1, padding: 8 }}
            />
            <button type="button" onClick={handleOpen} disabled={!canOpen || busy} style={{ padding: '8px 16px' }}>
              {busy ? 'Opening…' : 'Open this folder'}
            </button>
          </div>
        </>
      )}

      {error && <p style={{ color: 'crimson', marginBottom: 0, fontSize: 13 }}>{error}</p>}
    </div>
  );
}
