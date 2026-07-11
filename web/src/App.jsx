import { useEffect, useState } from 'react';
import Dashboard from './pages/Dashboard.jsx';
import ProjectView from './pages/ProjectView.jsx';
import LoginPage from './pages/LoginPage.jsx';
import { authApi } from './lib/auth.js';

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
