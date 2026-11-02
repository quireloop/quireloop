import { useEffect, useState } from 'react';
import Dashboard from './pages/Dashboard.jsx';
import ProjectView from './pages/ProjectView.jsx';
import LoginPage from './pages/LoginPage.jsx';
import LinkDevicePage from './pages/LinkDevicePage.jsx';
import { authApi } from './lib/auth.js';
import { api } from './api.js';
import { withTransition } from './lib/motion.js';
import DialogHost from './components/DialogHost.jsx';

export default function App() {
  const [openProjectId, setOpenProjectId] = useState(null);
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [linkCode, setLinkCode] = useState(() => new URLSearchParams(window.location.search).get('link'));

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

  const openProject = (id) => withTransition(() => setOpenProjectId(id));

  let page;
  if (!user) {
    page = <LoginPage onAuthenticated={(u) => withTransition(() => setUser(u))} />;
  } else if (linkCode) {
    page = (
      <LinkDevicePage
        code={linkCode}
        onDone={() => {
          window.history.replaceState({}, '', window.location.pathname);
          setLinkCode(null);
        }}
      />
    );
  } else if (openProjectId) {
    page = <ProjectView projectId={openProjectId} onBack={() => openProject(null)} user={user} />;
  } else {
    page = <Dashboard onOpen={openProject} user={user} onLogout={handleLogout} onUserUpdate={setUser} />;
  }

  return (
    <>
      {page}
      <DialogHost />
    </>
  );
}
