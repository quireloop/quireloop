import { useEffect, useState } from 'react';
import { authApi } from '../lib/auth.js';

function AssistantSettingsSection() {
  const [settings, setSettings] = useState(null);
  const [provider, setProvider] = useState('off'); // 'off' | 'anthropic' | 'ollama'
  const [anthropicKey, setAnthropicKey] = useState('');
  const [anthropicModel, setAnthropicModel] = useState('claude-opus-4-8');
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    try {
      const s = await authApi.getAssistantSettings();
      setSettings(s);
      setProvider(s.provider || 'off');
      setAnthropicModel(s.anthropicModel || 'claude-opus-4-8');
      setOllamaBaseUrl(s.ollamaBaseUrl || 'http://localhost:11434');
      setOllamaModel(s.ollamaModel || '');
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
      await authApi.saveAssistantSettings(patch);
      setAnthropicKey('');
      setStatus('Saved.');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleProviderChange(next) {
    setProvider(next);
    save({ provider: next === 'off' ? null : next });
  }

  if (!settings) return <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{error || 'Loading…'}</p>;

  return (
    <div style={{ display: 'grid', gap: 8, fontSize: 12 }}>
      <p style={{ margin: 0, color: 'var(--text-muted)' }}>
        Your own AI assistant — billed or run by you, not shared with other members. Claude Pro/Max
        subscriptions can&apos;t be used here (that login is restricted to Anthropic&apos;s own apps); use a
        pay-as-you-go{' '}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
          API key
        </a>{' '}
        instead, or point at an Ollama server if your lab runs one.
      </p>

      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="radio" checked={provider === 'off'} onChange={() => handleProviderChange('off')} disabled={busy} />
        Off
      </label>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="radio"
          checked={provider === 'anthropic'}
          onChange={() => handleProviderChange('anthropic')}
          disabled={busy}
        />
        Anthropic API key
      </label>
      {provider === 'anthropic' && (
        <div style={{ display: 'grid', gap: 6, marginLeft: 20 }}>
          {settings.anthropicKeySet ? (
            <span>
              ✅ Key set: <code>{settings.anthropicKeyMasked}</code>{' '}
              <button style={{ fontSize: 11, color: 'crimson' }} disabled={busy} onClick={() => save({ anthropicApiKey: '' })}>
                Remove
              </button>
            </span>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>No key set yet.</span>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (anthropicKey.trim()) save({ anthropicApiKey: anthropicKey.trim() });
            }}
            style={{ display: 'flex', gap: 6 }}
          >
            <input
              type="password"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder="sk-ant-…"
              style={{ flex: 1, padding: 6, fontSize: 12 }}
            />
            <button type="submit" disabled={busy || !anthropicKey.trim()} style={{ fontSize: 12 }}>
              Save
            </button>
          </form>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            Model
            <select
              value={anthropicModel}
              disabled={busy}
              onChange={(e) => {
                setAnthropicModel(e.target.value);
                save({ anthropicModel: e.target.value });
              }}
              style={{ fontSize: 12 }}
            >
              <option value="claude-opus-4-8">Claude Opus 4.8 (best)</option>
              <option value="claude-sonnet-5">Claude Sonnet 5 (cheaper)</option>
              <option value="claude-haiku-4-5">Claude Haiku 4.5 (cheapest)</option>
            </select>
          </label>
        </div>
      )}

      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="radio" checked={provider === 'ollama'} onChange={() => handleProviderChange('ollama')} disabled={busy} />
        Ollama (self-hosted, free)
      </label>
      {provider === 'ollama' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save({ ollamaBaseUrl: ollamaBaseUrl.trim(), ollamaModel: ollamaModel.trim() });
          }}
          style={{ display: 'grid', gap: 6, marginLeft: 20 }}
        >
          <label>
            Server URL
            <input
              value={ollamaBaseUrl}
              onChange={(e) => setOllamaBaseUrl(e.target.value)}
              placeholder="http://localhost:11434"
              style={{ width: '100%', padding: 6, fontSize: 12, marginTop: 2 }}
            />
          </label>
          <label>
            Model
            <input
              value={ollamaModel}
              onChange={(e) => setOllamaModel(e.target.value)}
              placeholder="llama3.1"
              style={{ width: '100%', padding: 6, fontSize: 12, marginTop: 2 }}
            />
          </label>
          <button type="submit" disabled={busy} style={{ fontSize: 12, padding: 6 }}>
            Save
          </button>
        </form>
      )}

      {status && <p style={{ margin: 0, color: 'var(--text-muted)' }}>{status}</p>}
      {error && <p style={{ margin: 0, color: 'crimson' }}>{error}</p>}
    </div>
  );
}

export default function AccountSettings({ user, onClose, onUserUpdate }) {
  const [setupData, setSetupData] = useState(null); // { uri, qrDataUrl }
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  async function handleChangePassword(e) {
    e.preventDefault();
    setPwError('');
    setPwSuccess('');
    if (newPassword.length < 8) {
      setPwError('new password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('new passwords do not match');
      return;
    }
    setPwBusy(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwSuccess('Password changed.');
    } catch (err) {
      setPwError(err.message);
    } finally {
      setPwBusy(false);
    }
  }

  async function handleStartSetup() {
    setError('');
    setBusy(true);
    try {
      setSetupData(await authApi.setup2fa());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmSetup(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await authApi.verify2fa(code.trim());
      setSetupData(null);
      setCode('');
      onUserUpdate({ ...user, twoFactorEnabled: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await authApi.disable2fa(password);
      setPassword('');
      onUserUpdate({ ...user, twoFactorEnabled: false });
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
        width: 340,
        maxHeight: 560,
        overflowY: 'auto',
        padding: 16,
        background: 'var(--panel-bg)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        zIndex: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong>{user?.email}</strong>
        <button onClick={onClose} style={{ fontSize: 13 }}>
          Close
        </button>
      </div>

      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
        Two-factor authentication: <strong>{user?.twoFactorEnabled ? 'Enabled' : 'Disabled'}</strong>
      </div>

      {error && <p style={{ color: 'crimson', fontSize: 13 }}>{error}</p>}

      {!user?.twoFactorEnabled && !setupData && (
        <button onClick={handleStartSetup} disabled={busy} style={{ fontSize: 13, width: '100%', padding: 6 }}>
          Enable 2FA
        </button>
      )}

      {setupData && (
        <form onSubmit={handleConfirmSetup} style={{ display: 'grid', gap: 8 }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
            Scan with an authenticator app, then enter the 6-digit code to confirm.
          </p>
          <img src={setupData.qrDataUrl} alt="2FA QR code" style={{ width: '100%', maxWidth: 200, margin: '0 auto' }} />
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            style={{ padding: 6, textAlign: 'center', letterSpacing: 2 }}
          />
          <button type="submit" disabled={busy} style={{ padding: 6, fontSize: 13 }}>
            Confirm
          </button>
        </form>
      )}

      {user?.twoFactorEnabled && (
        <form onSubmit={handleDisable} style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password to disable 2FA"
            type="password"
            style={{ padding: 6, fontSize: 13 }}
          />
          <button type="submit" disabled={busy} style={{ padding: 6, fontSize: 13 }}>
            Disable 2FA
          </button>
        </form>
      )}

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '12px 0' }} />

      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>Change password</div>
      <form onSubmit={handleChangePassword} style={{ display: 'grid', gap: 8 }}>
        <input
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="Current password"
          type="password"
          style={{ padding: 6, fontSize: 13 }}
        />
        <input
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="New password"
          type="password"
          style={{ padding: 6, fontSize: 13 }}
        />
        <input
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Confirm new password"
          type="password"
          style={{ padding: 6, fontSize: 13 }}
        />
        {pwError && <p style={{ color: 'crimson', fontSize: 12, margin: 0 }}>{pwError}</p>}
        {pwSuccess && <p style={{ color: 'seagreen', fontSize: 12, margin: 0 }}>{pwSuccess}</p>}
        <button type="submit" disabled={pwBusy} style={{ padding: 6, fontSize: 13 }}>
          {pwBusy ? 'Saving…' : 'Change password'}
        </button>
      </form>

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '12px 0' }} />

      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>✨ AI Assistant</div>
      <AssistantSettingsSection />
    </div>
  );
}
