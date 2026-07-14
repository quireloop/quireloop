import { useEffect, useState } from 'react';
import { api } from '../api.js';

function roleOf(c) {
  return c.role === 'viewer' ? 'viewer' : 'editor';
}

export default function ShareModal({ manifest, isOwner, onClose, onUpdated }) {
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [links, setLinks] = useState([]);
  const [linkRole, setLinkRole] = useState('editor');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [copiedToken, setCopiedToken] = useState('');

  useEffect(() => {
    if (!isOwner) return;
    api
      .listShareLinks(manifest.id)
      .then(setLinks)
      .catch(() => {});
  }, [isOwner, manifest.id]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setError('');
    setBusy(true);
    try {
      const updated = await api.shareProject(manifest.id, email.trim(), inviteRole);
      onUpdated(updated);
      setEmail('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(userId) {
    setBusy(true);
    setError('');
    try {
      const updated = await api.unshareProject(manifest.id, userId);
      onUpdated(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRoleChange(userId, role) {
    setBusy(true);
    setError('');
    try {
      const updated = await api.setCollaboratorRole(manifest.id, userId, role);
      onUpdated(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateLink() {
    setLinkBusy(true);
    setLinkError('');
    try {
      await api.createShareLink(manifest.id, linkRole);
      setLinks(await api.listShareLinks(manifest.id));
    } catch (err) {
      setLinkError(err.message);
    } finally {
      setLinkBusy(false);
    }
  }

  async function handleRevokeLink(token) {
    setLinkBusy(true);
    setLinkError('');
    try {
      await api.revokeShareLink(manifest.id, token);
      setLinks(await api.listShareLinks(manifest.id));
    } catch (err) {
      setLinkError(err.message);
    } finally {
      setLinkBusy(false);
    }
  }

  function linkUrl(token) {
    return `${window.location.origin}/?join=${token}`;
  }

  async function copyLink(token) {
    try {
      await navigator.clipboard.writeText(linkUrl(token));
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(''), 1500);
    } catch {
      // clipboard access denied — the link is still visible to copy by hand
    }
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 40,
        right: 0,
        width: 340,
        padding: 16,
        background: 'var(--panel-bg)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        zIndex: 10,
        maxHeight: '70vh',
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong>Share &ldquo;{manifest.name}&rdquo;</strong>
        <button onClick={onClose} style={{ fontSize: 13 }}>
          Close
        </button>
      </div>

      {isOwner && (
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Collaborator's email"
            type="email"
            style={{ flex: 1, padding: 6, fontSize: 13, minWidth: 0 }}
          />
          <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} style={{ fontSize: 13 }}>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button type="submit" disabled={busy} style={{ fontSize: 13, padding: '6px 10px' }}>
            Add
          </button>
        </form>
      )}

      {error && <p style={{ color: 'crimson', fontSize: 13, margin: '0 0 8px' }}>{error}</p>}

      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
        {(manifest.collaborators ?? []).length === 0 ? 'Not shared with anyone yet.' : 'Shared with:'}
      </div>
      <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
        {(manifest.collaborators ?? []).map((c) => (
          <div key={c.userId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, gap: 6 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {isOwner ? (
                <select
                  value={roleOf(c)}
                  disabled={busy}
                  onChange={(e) => handleRoleChange(c.userId, e.target.value)}
                  style={{ fontSize: 12 }}
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              ) : (
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{roleOf(c)}</span>
              )}
              {isOwner && (
                <button onClick={() => handleRemove(c.userId)} disabled={busy} style={{ color: 'crimson', fontSize: 12 }}>
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {isOwner && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <strong style={{ fontSize: 13 }}>Share link</strong>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, marginBottom: 8 }}>
            <select value={linkRole} onChange={(e) => setLinkRole(e.target.value)} style={{ fontSize: 13, flex: 1 }}>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
            <button onClick={handleCreateLink} disabled={linkBusy} style={{ fontSize: 13, padding: '6px 10px' }}>
              Create link
            </button>
          </div>
          {linkError && <p style={{ color: 'crimson', fontSize: 13, margin: '0 0 8px' }}>{linkError}</p>}
          <div style={{ display: 'grid', gap: 6 }}>
            {links.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>No active links.</p>}
            {links.map((l) => (
              <div key={l.token} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <code
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: 'var(--text-muted)',
                  }}
                  title={linkUrl(l.token)}
                >
                  {linkUrl(l.token)}
                </code>
                <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{l.role}</span>
                <button onClick={() => copyLink(l.token)} disabled={linkBusy} style={{ fontSize: 11, flexShrink: 0 }}>
                  {copiedToken === l.token ? 'Copied!' : 'Copy'}
                </button>
                <button
                  onClick={() => handleRevokeLink(l.token)}
                  disabled={linkBusy}
                  style={{ color: 'crimson', fontSize: 11, flexShrink: 0 }}
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
