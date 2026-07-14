import { useEffect, useState } from 'react';
import Dashboard from './pages/Dashboard.jsx';
import ProjectView from './pages/ProjectView.jsx';
import LoginPage from './pages/LoginPage.jsx';
import { authApi } from './lib/auth.js';
import { api } from './api.js';

export default function App() {
  const [openProjectId, setOpenProjectId] = useState(null);
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    authApi
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setCheckingAuth(false));
  }, []);

  // ?join=TOKEN survives the login flow (it's the same page, no redirect) —
  // once we know who's authenticated, redeem it and drop straight into the
  // project, same as clicking it from the dashboard.
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('join');
    if (!token) return;
    api
      .joinShareLink(token)
      .then(({ projectId }) => setOpenProjectId(projectId))
      .catch(() => {})
      .finally(() => {
        params.delete('join');
        const rest = params.toString();
        const url = window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash;
        window.history.replaceState({}, '', url);
      });
  }, [user]);

  function handleLogout() {
    setUser(null);
    setOpenProjectId(null);
  }

  if (checkingAuth) return null;

  if (!user) {
    return <LoginPage onAuthenticated={setUser} />;
  }

  if (openProjectId) {
    return <ProjectView projectId={openProjectId} onBack={() => setOpenProjectId(null)} user={user} />;
  }
  return <Dashboard onOpen={setOpenProjectId} user={user} onLogout={handleLogout} onUserUpdate={setUser} />;
}
