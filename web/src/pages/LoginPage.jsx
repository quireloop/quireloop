import { useState } from 'react';
import { authApi } from '../lib/auth.js';
import Logo from '../components/Logo.jsx';
import ReactiveBackground from '../components/ReactiveBackground.jsx';
import { useDarkMode } from '../lib/theme.js';

const CARD_STYLE = {
  maxWidth: 360,
  margin: '0 auto',
  padding: 28,
  background: 'var(--panel-bg)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
};

function Hero() {
  return (
    <div style={{ textAlign: 'center', marginBottom: 40 }}>
      <h1
        style={{
          fontFamily: 'ui-monospace, "SF Mono", monospace',
          fontSize: 'clamp(34px, 6vw, 58px)',
          fontWeight: 700,
          margin: 0,
          lineHeight: 1.1,
        }}
      >
        <span style={{ color: '#e7a13a' }}>{'\\begin{'}</span>
        <span style={{ color: 'var(--text)' }}>focus</span>
        <span style={{ color: '#e7a13a' }}>{'}'}</span>
      </h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 16, maxWidth: 480, margin: '14px auto 0' }}>
        A self-hosted LaTeX workspace for labs who'd rather own their papers than rent them.
      </p>
    </div>
  );
}

function Page({ children }) {
  const [dark] = useDarkMode();
  return (
    <div style={{ position: 'relative', minHeight: '100vh', overflow: 'hidden' }}>
      <ReactiveBackground dark={dark} />
      <div style={{ position: 'relative', zIndex: 1, padding: '80px 16px' }}>
        <Hero />
        {children}
      </div>
    </div>
  );
}

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
      <Page>
        <div style={CARD_STYLE}>
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
      </Page>
    );
  }

  return (
    <Page>
      <div style={CARD_STYLE}>
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
    </Page>
  );
}
