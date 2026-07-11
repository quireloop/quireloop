import { useState } from 'react';
import { authApi } from '../lib/auth.js';
import Logo from '../components/Logo.jsx';
import ReactiveBackground from '../components/ReactiveBackground.jsx';
import FeatureGrid from '../components/FeatureGrid.jsx';
import EditorPreview from '../components/EditorPreview.jsx';
import { useDarkMode } from '../lib/theme.js';

const GITHUB_URL = 'https://github.com/arjunpogaku/quireloop';

const CARD_STYLE = {
  maxWidth: 360,
  margin: '0 auto',
  padding: 28,
  background: 'var(--panel-bg)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
};

function NavBar() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        maxWidth: 1000,
        margin: '0 auto',
        padding: '4px 8px 40px',
      }}
    >
      <Logo size={26} />
      <strong>Quireloop</strong>
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          marginLeft: 'auto',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--text-muted)',
          textDecoration: 'none',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
        </svg>
        Open source
      </a>
    </div>
  );
}

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

function Footer() {
  return (
    <div
      style={{
        textAlign: 'center',
        fontSize: 12,
        color: 'var(--text-muted)',
        padding: '56px 16px 32px',
      }}
    >
      Quireloop is free and open source, MIT-licensed.{' '}
      <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
        View the source on GitHub
      </a>
      .
    </div>
  );
}

function Page({ children, marketing }) {
  const [dark] = useDarkMode();
  return (
    <div style={{ position: 'relative', minHeight: '100vh', overflow: 'hidden' }}>
      <ReactiveBackground dark={dark} />
      <div style={{ position: 'relative', zIndex: 1, padding: '48px 16px 0' }}>
        <NavBar />
        <Hero />
        {children}
        {marketing && (
          <>
            <div style={{ margin: '64px 16px 40px' }}>
              <EditorPreview />
            </div>
            <div style={{ margin: '0 16px' }}>
              <FeatureGrid />
            </div>
            <Footer />
          </>
        )}
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
    <Page marketing>
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
