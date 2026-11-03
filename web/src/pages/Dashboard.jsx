import { BASE_PATH } from '../basePath.js';
import { useEffect, useRef, useState } from 'react';
import { api, linkApi } from '../api.js';
import { confirmDialog } from '../lib/dialog.js';
import { authApi } from '../lib/auth.js';
import { useDarkMode } from '../lib/theme.js';
import Logo from '../components/Logo.jsx';
import AccountSettings from '../components/AccountSettings.jsx';
import AdminPanel from '../components/AdminPanel.jsx';
import FolderBrowser from '../components/FolderBrowser.jsx';
import CopyrightNotice from '../components/CopyrightNotice.jsx';
import ServerLinkPanel from '../components/ServerLinkPanel.jsx';

function ImportFromGit({ onClose, onImported }) {
  const [name, setName] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!gitUrl.trim()) return;
    setBusy(true);
    setError('');
    try {
      const manifest = await api.importFromGit(name.trim(), gitUrl.trim(), token.trim());
      onImported(manifest);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        padding: 16,
        marginBottom: 24,
        background: 'var(--panel-bg)',
        borderRadius: 8,
        border: '1px solid var(--border)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong>Import from Git</strong>
        <button type="button" onClick={onClose} style={{ fontSize: 13 }}>
          Close
        </button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
        Paste the project's git clone URL. If it is private, add an access token from your git host.
      </p>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 8 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Project name (optional)"
          style={{ padding: 8 }}
        />
        <input
          value={gitUrl}
          onChange={(e) => setGitUrl(e.target.value)}
          placeholder="https://example.org/your-project.git"
          style={{ padding: 8 }}
          required
        />
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Git token"
          type="password"
          style={{ padding: 8 }}
        />
        {error && <p style={{ color: 'crimson', margin: 0, fontSize: 13 }}>{error}</p>}
        <button type="submit" disabled={busy} style={{ padding: '8px 16px', justifySelf: 'start' }}>
          {busy ? 'Cloning…' : 'Import'}
        </button>
      </form>
    </div>
  );
}

export default function Dashboard({ onOpen, user, onLogout, onUserUpdate }) {
  const [projects, setProjects] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [newName, setNewName] = useState('');
  const [templateId, setTemplateId] = useState('blank');
  const [error, setError] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showFolders, setShowFolders] = useState(false);
  const [libraryRoots, setLibraryRoots] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [serverConnected, setServerConnected] = useState(false);
  const [dark, setDark] = useDarkMode();
  const uploadInputRef = useRef(null);

  // A shared server has nothing to link to; only a personal install does.
  const isOwnComputer = ['localhost', '127.0.0.1'].includes(window.location.hostname);

  function handleLinkChange(status) {
    setServerConnected(Boolean(status.url));
    refresh();
  }

  async function handlePublish(project) {
    try {
      await linkApi.publish(project.id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleLogout() {
    await authApi.logout();
    onLogout();
  }

  async function refresh() {
    try {
      setProjects(await api.listProjects());
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    api.listTemplates().then(setTemplates);
    // Opening server folders is off unless the operator allowlisted some, so
    // the button only appears when there's actually something to browse.
    api
      .libraryRoots()
      .then((res) => setLibraryRoots(res.enabled ? res.roots : []))
      .catch(() => setLibraryRoots([]));
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await api.createProject(newName.trim(), templateId);
      setNewName('');
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  // A linked project is a folder the user already had — removing it only stops
  // Quireloop showing it, so the wording must not imply their files are going
  // anywhere.
  async function handleDelete(project) {
    const confirmed = await confirmDialog(
      project.linkedPath
        ? {
            title: `Remove "${project.name}" from Quireloop?`,
            message: `Your folder at ${project.linkedPath} stays exactly where it is — only the link to it is removed.`,
            confirmLabel: 'Remove',
          }
        : {
            title: `Delete "${project.name}"?`,
            message: project.sync
              ? 'This removes the copy on this computer. The paper stays on the server.'
              : 'This cannot be undone.',
            confirmLabel: 'Delete',
            danger: true,
          }
    );
    if (!confirmed) return;
    await api.deleteProject(project.id);
    await refresh();
  }

  async function handleImported() {
    setShowImport(false);
    await refresh();
  }

  async function handleUploadZip(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so picking the same file again still fires onChange
    if (!file) return;
    const name = file.name.replace(/\.zip$/i, '');
    setUploading(true);
    setUploadError('');
    try {
      await api.uploadProjectZip(name, file);
      await refresh();
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 720, margin: '40px auto', padding: '0 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo size={32} />
          Quireloop
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
          {user?.role === 'admin' && (
            <button onClick={() => setShowAdmin(true)} style={{ fontSize: 13, height: 32 }}>
              Admin
            </button>
          )}
          <button onClick={() => setShowSettings((v) => !v)} style={{ fontSize: 13, height: 32 }}>
            {user?.email}
          </button>
          {showSettings && (
            <AccountSettings user={user} onClose={() => setShowSettings(false)} onUserUpdate={onUserUpdate} />
          )}
          <button onClick={() => setDark(!dark)} style={{ fontSize: 13, height: 32 }}>
            {dark ? '☀ Light mode' : '🌙 Dark mode'}
          </button>
          <button onClick={handleLogout} style={{ fontSize: 13, height: 32 }}>
            Log out
          </button>
        </div>
      </div>
      {showAdmin && <AdminPanel user={user} onClose={() => setShowAdmin(false)} />}
      {isOwnComputer && user?.role === 'admin' && <ServerLinkPanel onChange={handleLinkChange} />}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <form onSubmit={handleCreate} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New project name"
          style={{ flex: 1, padding: 8 }}
        />
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} style={{ padding: 8 }}>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <button type="submit" className="primary-button" style={{ padding: '8px 16px' }}>
          New Project
        </button>
      </form>

      {!showImport && !showFolders && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
          {libraryRoots.length > 0 && (
            <button onClick={() => setShowFolders(true)} style={{ fontSize: 13 }}>
              Open a Folder…
            </button>
          )}
          <button onClick={() => setShowImport(true)} style={{ fontSize: 13 }}>
            Import from Git…
          </button>
          <button onClick={() => uploadInputRef.current?.click()} disabled={uploading} style={{ fontSize: 13 }}>
            {uploading ? 'Uploading…' : 'Upload Project (.zip)…'}
          </button>
          <button
            onClick={() => {
              window.location.href = `${BASE_PATH}/api/export/all`;
            }}
            title="Download every paper you own or share, as one .zip. Keep it somewhere safe."
            style={{ fontSize: 13 }}
          >
            Download all my papers
          </button>
          <input ref={uploadInputRef} type="file" accept=".zip" onChange={handleUploadZip} style={{ display: 'none' }} />
          {uploadError && <span style={{ color: 'crimson', fontSize: 13 }}>{uploadError}</span>}
        </div>
      )}
      {showImport && <ImportFromGit onClose={() => setShowImport(false)} onImported={handleImported} />}
      {showFolders && (
        <FolderBrowser
          roots={libraryRoots}
          onClose={() => setShowFolders(false)}
          onOpened={(project) => {
            setShowFolders(false);
            onOpen(project.id);
          }}
        />
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {projects.map((p) => (
          <div key={p.id} className="project-card" onClick={() => onOpen(p.id)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{p.name}</strong>
              {p.ownerId !== user?.id && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: 'var(--accent-bg)',
                    color: 'var(--text-muted)',
                  }}
                >
                  Shared{p.yourRole ? ` · ${p.yourRole}` : ''}
                </span>
              )}
              {p.linkedPath && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: 'var(--accent-bg)',
                    color: 'var(--text-muted)',
                  }}
                  title={p.linkedPath}
                >
                  Folder
                </span>
              )}
              {p.sync && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: 'var(--accent-bg)',
                    color: 'var(--text-muted)',
                  }}
                >
                  On server{p.sync.role === 'viewer' ? ' · read-only' : ''}
                </span>
              )}
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Updated {new Date(p.updatedAt).toLocaleString()}
                {p.linkedPath && ` · ${p.linkedPath}`}
              </div>
            </div>
            {serverConnected && !p.sync && p.ownerId === user?.id && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handlePublish(p);
                }}
              >
                Put on server
              </button>
            )}
            <a href={api.downloadUrl(p.id)} download className="link-button" onClick={(e) => e.stopPropagation()}>
              Download .zip
            </a>
            {p.ownerId === user?.id && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(p);
                }}
                style={{ color: 'var(--danger)', background: 'transparent' }}
              >
                {p.linkedPath ? 'Remove' : 'Delete'}
              </button>
            )}
          </div>
        ))}
        {projects.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No projects yet.</p>}
      </div>
      <div style={{ textAlign: 'center', marginTop: 32, fontSize: 12, color: 'var(--text-muted)' }}>
        Quireloop, built by{' '}
        <a href="https://github.com/arjunpogaku" target="_blank" rel="noreferrer">
          Arjun Pogaku
        </a>
        <CopyrightNotice style={{ marginTop: 6, paddingBottom: 16 }} />
      </div>
      </div>
    </div>
  );
}
