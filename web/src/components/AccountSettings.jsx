import { useState } from 'react';
import { authApi } from '../lib/auth.js';

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
        width: 320,
        maxHeight: 480,
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
    </div>
  );
}
