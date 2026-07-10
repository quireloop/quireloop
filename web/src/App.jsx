import { useState } from 'react';
import Dashboard from './pages/Dashboard.jsx';
import ProjectView from './pages/ProjectView.jsx';

export default function App() {
  const [openProjectId, setOpenProjectId] = useState(null);

  if (openProjectId) {
    return <ProjectView projectId={openProjectId} onBack={() => setOpenProjectId(null)} />;
  }
  return <Dashboard onOpen={setOpenProjectId} />;
}
