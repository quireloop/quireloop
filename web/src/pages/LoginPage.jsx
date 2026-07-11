import { useState } from 'react';
import { authApi } from '../lib/auth.js';
import Logo from '../components/Logo.jsx';

export default function LoginPage({ onAuthenticated }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Set once login() responds { needsTwoFactor, tempToken } — switches the
  // form to a second step asking for the TOTP code instead of email/password.
  const [tempToken, setTempToken] = useState(null);
  const [code, setCode] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'signup') {
        const user = await authApi.signup(email.trim(), password);
        onAuthenticated(user);
        return;
      }
      const result = await authApi.login(email.trim(), password);
      if (result.needsTwoFactor) {
        setTempToken(result.tempToken);
      } else {
        onAuthenticated(result);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleTwoFactorSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const user = await authApi.loginTwoFactor(tempToken, code.trim());
      onAuthenticated(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (tempToken) {
    return (
      <div style={{ maxWidth: 360, margin: '80px auto', padding: '0 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Logo size={32} />
          <h1 style={{ margin: 0 }}>Quireloop</h1>
        </div>
        <p style={{ color: 'var(--text-muted)' }}>Enter the 6-digit code from your authenticator app.</p>
        <form onSubmit={handleTwoFactorSubmit} style={{ display: 'grid', gap: 8 }}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            autoFocus
            style={{ padding: 8, fontSize: 18, textAlign: 'center', letterSpacing: 4 }}
          />
          {error && <p style={{ color: 'crimson', margin: 0 }}>{error}</p>}
          <button type="submit" disabled={busy} style={{ padding: 8 }}>
            {busy ? 'Verifying…' : 'Verify'}
          </button>
          <button type="button" onClick={() => setTempToken(null)} style={{ padding: 8 }}>
            Back
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 360, margin: '80px auto', padding: '0 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Logo size={32} />
        <h1 style={{ margin: 0 }}>Quireloop</h1>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => setMode('login')}
          style={{ flex: 1, background: mode === 'login' ? 'var(--accent-bg)' : undefined }}
        >
          Log in
        </button>
        <button
          onClick={() => setMode('signup')}
          style={{ flex: 1, background: mode === 'signup' ? 'var(--accent-bg)' : undefined }}
        >
          Sign up
        </button>
      </div>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 8 }}>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          type="email"
          autoFocus
          style={{ padding: 8 }}
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          type="password"
          style={{ padding: 8 }}
        />
        {error && <p style={{ color: 'crimson', margin: 0 }}>{error}</p>}
        <button type="submit" disabled={busy} style={{ padding: 8 }}>
          {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Log in'}
        </button>
      </form>
    </div>
  );
}
