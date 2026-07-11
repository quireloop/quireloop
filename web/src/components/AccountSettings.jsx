import { useState } from 'react';
import { authApi } from '../lib/auth.js';

export default function AccountSettings({ user, onClose, onUserUpdate }) {
  const [setupData, setSetupData] = useState(null); // { uri, qrDataUrl }
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
    </div>
  );
}
