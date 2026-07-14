import { useEffect, useState } from 'react';
import { adminApi } from '../lib/auth.js';

function UsersSection({ currentUserId }) {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  async function refresh() {
    try {
      setUsers(await adminApi.listUsers());
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function toggleDisabled(u) {
    setError('');
    setBusyId(u.id);
    try {
      if (u.disabled) await adminApi.enableUser(u.id);
      else await adminApi.disableUser(u.id);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      {error && <p style={{ color: 'crimson', fontSize: 13 }}>{error}</p>}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
            <th style={{ padding: '4px 6px', borderBottom: '1px solid var(--border)' }}>Email</th>
            <th style={{ padding: '4px 6px', borderBottom: '1px solid var(--border)' }}>Role</th>
            <th style={{ padding: '4px 6px', borderBottom: '1px solid var(--border)' }}>Created</th>
            <th style={{ padding: '4px 6px', borderBottom: '1px solid var(--border)' }}></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td style={{ padding: '6px' }}>
                {u.email}
                {u.disabled && (
                  <span style={{ marginLeft: 6, fontSize: 11, color: 'crimson' }}>disabled</span>
                )}
              </td>
              <td style={{ padding: '6px' }}>{u.role}</td>
              <td style={{ padding: '6px', color: 'var(--text-muted)' }}>
                {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
              </td>
              <td style={{ padding: '6px', textAlign: 'right' }}>
                {u.id !== currentUserId && (
                  <button
                    onClick={() => toggleDisabled(u)}
                    disabled={busyId === u.id}
                    style={{ fontSize: 12, color: u.disabled ? undefined : 'crimson' }}
                  >
                    {u.disabled ? 'Enable' : 'Disable'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {users.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No users.</p>}
    </div>
  );
}

function InvitesSection() {
  const [invites, setInvites] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastCode, setLastCode] = useState(null);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    try {
      setInvites(await adminApi.listInvites());
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate() {
    setError('');
    setBusy(true);
    setCopied(false);
    try {
      const { code } = await adminApi.createInvite();
      setLastCode(code);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(code) {
    setError('');
    try {
      await adminApi.revokeInvite(code);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  function inviteUrl(code) {
    return `${window.location.origin}/?invite=${code}`;
  }

  async function handleCopy(code) {
    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      setCopied(true);
    } catch {
      // clipboard API unavailable — the URL is still shown for manual copy
    }
  }

  return (
    <div>
      <button onClick={handleCreate} disabled={busy} style={{ fontSize: 13, marginBottom: 8 }}>
        {busy ? 'Generating…' : 'Generate invite'}
      </button>
      {error && <p style={{ color: 'crimson', fontSize: 13 }}>{error}</p>}
      {lastCode && (
        <div
          style={{
            padding: 8,
            marginBottom: 8,
            background: 'var(--accent-bg)',
            borderRadius: 6,
            fontSize: 12,
            display: 'grid',
            gap: 4,
          }}
        >
          <div>
            Code: <strong>{lastCode}</strong>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input readOnly value={inviteUrl(lastCode)} style={{ flex: 1, padding: 4, fontSize: 11 }} />
            <button onClick={() => handleCopy(lastCode)} style={{ fontSize: 11 }}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gap: 6 }}>
        {invites.map((i) => (
          <div
            key={i.code}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 12,
              padding: '4px 0',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span>
              <code>{i.code}</code>{' '}
              {i.usedBy ? (
                <span style={{ color: 'var(--text-muted)' }}>used</span>
              ) : (
                <span style={{ color: 'seagreen' }}>unused</span>
              )}
            </span>
            {!i.usedBy && (
              <button onClick={() => handleRevoke(i.code)} style={{ fontSize: 11, color: 'crimson' }}>
                Revoke
              </button>
            )}
          </div>
        ))}
        {invites.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No invites yet.</p>}
      </div>
    </div>
  );
}

export default function AdminPanel({ user, onClose }) {
  const [tab, setTab] = useState('users'); // 'users' | 'invites'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: '90vw',
          maxHeight: '80vh',
          overflowY: 'auto',
          padding: 20,
          background: 'var(--panel-bg)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong>Admin panel</strong>
          <button onClick={onClose} style={{ fontSize: 13 }}>
            Close
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            onClick={() => setTab('users')}
            style={{ flex: 1, background: tab === 'users' ? 'var(--accent-bg)' : undefined }}
          >
            Users
          </button>
          <button
            onClick={() => setTab('invites')}
            style={{ flex: 1, background: tab === 'invites' ? 'var(--accent-bg)' : undefined }}
          >
            Invites
          </button>
        </div>
        {tab === 'users' ? <UsersSection currentUserId={user?.id} /> : <InvitesSection />}
      </div>
    </div>
  );
}
