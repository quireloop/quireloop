import { useState } from 'react';
import { api } from '../api.js';

export default function ShareModal({ manifest, isOwner, onClose, onUpdated }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleAdd(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setError('');
    setBusy(true);
    try {
      const updated = await api.shareProject(manifest.id, email.trim());
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

  return (
    <div
      style={{
        position: 'absolute',
        top: 40,
        right: 0,
        width: 320,
        padding: 16,
        background: 'var(--panel-bg)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        zIndex: 10,
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
            style={{ flex: 1, padding: 6, fontSize: 13 }}
          />
          <button type="submit" disabled={busy} style={{ fontSize: 13, padding: '6px 10px' }}>
            Add
          </button>
        </form>
      )}

      {error && <p style={{ color: 'crimson', fontSize: 13, margin: '0 0 8px' }}>{error}</p>}

      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
        {(manifest.collaborators ?? []).length === 0 ? 'Not shared with anyone yet.' : 'Shared with:'}
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {(manifest.collaborators ?? []).map((c) => (
          <div key={c.userId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
            <span>{c.email}</span>
            {isOwner && (
              <button onClick={() => handleRemove(c.userId)} disabled={busy} style={{ color: 'crimson', fontSize: 12 }}>
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
