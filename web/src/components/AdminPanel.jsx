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

function AssistantSection() {
  const [settings, setSettings] = useState(null);
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const s = await adminApi.getSettings();
      setSettings(s);
      setModel(s.assistantModel || '');
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function save(patch) {
    setError('');
    setStatus('');
    setBusy(true);
    try {
      await adminApi.saveSettings(patch);
      setKey('');
      setStatus('Saved — takes effect immediately, no restart needed.');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{error || 'Loading…'}</p>;

  return (
    <div style={{ display: 'grid', gap: 10, fontSize: 13 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
        The ✨ Assistant panel is powered by the Anthropic API. Paste an API key from{' '}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
          console.anthropic.com
        </a>{' '}
        to enable it for everyone on this server. Usage is billed to this key. Claude Pro/Max subscriptions
        don&apos;t include API access — an API key is a separate pay-as-you-go account.
      </p>
      {settings.keyFromEnv ? (
        <p style={{ margin: 0, fontSize: 12 }}>
          ✅ Key is set via environment variable — that takes precedence, so this field is disabled.
        </p>
      ) : settings.anthropicApiKey ? (
        <p style={{ margin: 0, fontSize: 12 }}>
          ✅ Assistant enabled with key <code>{settings.anthropicApiKey}</code>{' '}
          <button
            style={{ fontSize: 11, marginLeft: 6, color: 'crimson' }}
            disabled={busy}
            onClick={() => save({ anthropicApiKey: '' })}
          >
            Remove key
          </button>
        </p>
      ) : (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>Assistant is currently disabled — no key set.</p>
      )}
      {!settings.keyFromEnv && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) save({ anthropicApiKey: key.trim() });
          }}
          style={{ display: 'flex', gap: 6 }}
        >
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-ant-…"
            style={{ flex: 1, padding: 6, fontSize: 12 }}
          />
          <button type="submit" disabled={busy || !key.trim()} style={{ fontSize: 12 }}>
            Save key
          </button>
        </form>
      )}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        Model
        <select
          value={model}
          disabled={busy}
          onChange={(e) => {
            setModel(e.target.value);
            save({ assistantModel: e.target.value });
          }}
          style={{ fontSize: 12 }}
        >
          <option value="claude-opus-4-8">Claude Opus 4.8 (best, default)</option>
          <option value="claude-sonnet-5">Claude Sonnet 5 (cheaper)</option>
          <option value="claude-haiku-4-5">Claude Haiku 4.5 (cheapest)</option>
        </select>
      </label>
      {status && <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>{status}</p>}
      {error && <p style={{ margin: 0, fontSize: 12, color: 'crimson' }}>{error}</p>}
    </div>
  );
}

export default function AdminPanel({ user, onClose }) {
  const [tab, setTab] = useState('users'); // 'users' | 'invites' | 'assistant'

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
          <button
            onClick={() => setTab('assistant')}
            style={{ flex: 1, background: tab === 'assistant' ? 'var(--accent-bg)' : undefined }}
          >
            ✨ Assistant
          </button>
        </div>
        {tab === 'users' && <UsersSection currentUserId={user?.id} />}
        {tab === 'invites' && <InvitesSection />}
        {tab === 'assistant' && <AssistantSection />}
      </div>
    </div>
  );
}
