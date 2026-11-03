import { useEffect, useState } from 'react';
import { authApi } from '../lib/auth.js';
import { assistantApi, linkApi } from '../api.js';

function LinkedComputersSection() {
  const [devices, setDevices] = useState([]);
  const refresh = () => linkApi.listDevices().then(setDevices).catch(() => setDevices([]));

  useEffect(() => {
    refresh();
  }, []);

  if (devices.length === 0) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <strong style={{ fontSize: 13 }}>Linked computers</strong>
      {devices.map((d) => (
        <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, marginTop: 6 }}>
          <span title={d.lastSeenAt ? `Last seen ${new Date(d.lastSeenAt).toLocaleString()}` : undefined}>{d.name}</span>
          <button style={{ fontSize: 12 }} onClick={() => linkApi.revokeDevice(d.id).then(refresh)}>
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

function AssistantSettingsSection() {
  const [settings, setSettings] = useState(null);
  const [provider, setProvider] = useState('off'); // 'off' | 'anthropic' | 'ollama'
  const [anthropicKey, setAnthropicKey] = useState('');
  const [anthropicModel, setAnthropicModel] = useState('claude-opus-4-8');
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState('');
  const [ollamaModels, setOllamaModels] = useState(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [keyModels, setKeyModels] = useState([]);
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

  async function findOllamaModels(baseUrl) {
    setError('');
    setOllamaModels(null);
    try {
      const { models } = await assistantApi.findOllamaModels(baseUrl.trim());
      setOllamaModels(models);
      setOllamaModel((current) => (models.includes(current) ? current : models[0] || ''));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    if (provider === 'ollama' && settings) findOllamaModels(ollamaBaseUrl);
    if (provider === 'openai' || provider === 'gemini') {
      assistantApi.models().then((next) => setKeyModels(next.provider === provider ? next.models : [])).catch(() => {});
    }
  }, [provider, settings?.openaiKeySet, settings?.geminiKeySet]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(patch) {
    setError('');
    setStatus('');
    setBusy(true);
    try {
      await authApi.saveAssistantSettings(patch);
      setAnthropicKey('');
      setKeyDraft('');
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
        Your own AI assistant, paid for or run by you and not shared with other members. A ChatGPT, Claude or Gemini
        subscription can&apos;t be connected here, because those companies keep subscriptions to their own apps. Instead
        the Assistant panel has buttons that copy your question and open the subscription in a new tab. To use the
        panel itself, add a pay-as-you-go API key below, or use the lab&apos;s local models.
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
        Local models on a server (Ollama, free and private)
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
          <button type="button" style={{ fontSize: 12 }} onClick={() => findOllamaModels(ollamaBaseUrl)}>
            Find models on this server
          </button>
          <label>
            Model
            <select
              value={ollamaModel}
              onChange={(e) => setOllamaModel(e.target.value)}
              disabled={!ollamaModels?.length}
              style={{ width: '100%', padding: 6, fontSize: 12, marginTop: 2 }}
            >
              {!ollamaModels?.length && <option value="">{ollamaModels ? 'No models installed there' : 'Looking…'}</option>}
              {ollamaModels?.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy} style={{ fontSize: 12, padding: 6 }}>
            Save
          </button>
        </form>
      )}

      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="radio" checked={provider === 'openai'} onChange={() => handleProviderChange('openai')} disabled={busy} />
        OpenAI API key
      </label>
      {provider === 'openai' && (
        <div style={{ display: 'grid', gap: 6, marginLeft: 20 }}>
          {settings.openaiKeySet ? (
            <span>
              ✅ Key set: <code>{settings.openaiKeyMasked}</code>{' '}
              <button style={{ fontSize: 11, color: 'crimson' }} disabled={busy} onClick={() => save({ openaiApiKey: '' })}>
                Remove
              </button>
            </span>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
                Get a key
              </a>
              . This is separate from any subscription.
            </span>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (keyDraft.trim()) save({ openaiApiKey: keyDraft.trim() });
            }}
            style={{ display: 'flex', gap: 6 }}
          >
            <input
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="sk-…"
              style={{ flex: 1, padding: 6, fontSize: 12 }}
            />
            <button type="submit" disabled={busy || !keyDraft.trim()} style={{ fontSize: 12 }}>
              Save
            </button>
          </form>
          {settings.openaiKeySet && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              Model
              <select
                value={settings.openaiModel || keyModels[0] || ''}
                disabled={busy}
                onChange={(e) => save({ openaiModel: e.target.value })}
                style={{ fontSize: 12, flex: 1, minWidth: 0 }}
              >
                {keyModels.length === 0 && <option value="">Checking your key…</option>}
                {keyModels.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="radio" checked={provider === 'gemini'} onChange={() => handleProviderChange('gemini')} disabled={busy} />
        Google Gemini API key
      </label>
      {provider === 'gemini' && (
        <div style={{ display: 'grid', gap: 6, marginLeft: 20 }}>
          {settings.geminiKeySet ? (
            <span>
              ✅ Key set: <code>{settings.geminiKeyMasked}</code>{' '}
              <button style={{ fontSize: 11, color: 'crimson' }} disabled={busy} onClick={() => save({ geminiApiKey: '' })}>
                Remove
              </button>
            </span>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                Get a key
              </a>
              . This is separate from any subscription.
            </span>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (keyDraft.trim()) save({ geminiApiKey: keyDraft.trim() });
            }}
            style={{ display: 'flex', gap: 6 }}
          >
            <input
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="Paste your key"
              style={{ flex: 1, padding: 6, fontSize: 12 }}
            />
            <button type="submit" disabled={busy || !keyDraft.trim()} style={{ fontSize: 12 }}>
              Save
            </button>
          </form>
          {settings.geminiKeySet && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              Model
              <select
                value={settings.geminiModel || keyModels[0] || ''}
                disabled={busy}
                onChange={(e) => save({ geminiModel: e.target.value })}
                style={{ fontSize: 12, flex: 1, minWidth: 0 }}
              >
                {keyModels.length === 0 && <option value="">Checking your key…</option>}
                {keyModels.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {status && <p style={{ margin: 0, color: 'var(--text-muted)' }}>{status}</p>}
      {error && <p style={{ margin: 0, color: 'crimson' }}>{error}</p>}
    </div>
  );
}

export default function AccountSettings({ user, onClose, onUserUpdate }) {
  // Credentials for these live on the host, not in Quireloop, so every control
  // that would change one is hidden rather than shown and then rejected.
  const isServerAccount = user?.authProvider === 'pam';
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
      className="pop-in"
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
        borderRadius: 'var(--radius)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        zIndex: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        {/* A server account has a username; the email address it carries is
            synthesized and would only confuse. */}
        <strong>{isServerAccount ? user.unixUser : user?.email}</strong>
        <button onClick={onClose} style={{ fontSize: 13 }}>
          Close
        </button>
      </div>

      {isServerAccount && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px' }}>
          You sign in with your account on this server, so your password and two-factor authentication are
          managed there — change them the same way you would for SSH.
        </p>
      )}

      {!isServerAccount && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
          Two-factor authentication: <strong>{user?.twoFactorEnabled ? 'Enabled' : 'Disabled'}</strong>
        </div>
      )}

      {error && <p style={{ color: 'crimson', fontSize: 13 }}>{error}</p>}

      {!isServerAccount && !user?.twoFactorEnabled && !setupData && (
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

      {!isServerAccount && user?.twoFactorEnabled && (
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

      {!isServerAccount && (
        <>
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
        </>
      )}

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '12px 0' }} />

      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>✨ AI Assistant</div>
      <LinkedComputersSection />
      <AssistantSettingsSection />
    </div>
  );
}
