const BASE = '/api/auth';

async function request(path, options = {}) {
  const res = await fetch(BASE + path, options);
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function post(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export const authApi = {
  me: () => request('/me'),
  signup: (email, password) => post('/signup', { email, password }),
  login: (email, password) => post('/login', { email, password }),
  loginTwoFactor: (tempToken, code) => post('/login/2fa', { tempToken, code }),
  logout: () => request('/logout', { method: 'POST' }),
  setup2fa: () => post('/2fa/setup', {}),
  verify2fa: (code) => post('/2fa/verify', { code }),
  disable2fa: (password) => post('/2fa/disable', { password }),
};
