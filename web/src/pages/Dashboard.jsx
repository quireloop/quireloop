import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { authApi } from '../lib/auth.js';
import { useDarkMode } from '../lib/theme.js';
import Logo from '../components/Logo.jsx';
import AccountSettings from '../components/AccountSettings.jsx';

function ImportFromthe hosted editor({ onClose, onImported }) {
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
        <strong>Import from the hosted editor</strong>
        <button type="button" onClick={onClose} style={{ fontSize: 13 }}>
          Close
        </button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
        In the hosted editor, open your project → Menu → Git → copy the clone URL (looks like{' '}
        <code>https://git.hosted-editor.com/&lt;project-id&gt;</code>). Then, in the same panel, generate a Git token
        and paste it below — that's your username, no password needed.
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
          placeholder="https://git.hosted-editor.com/your-project-id"
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
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [dark, setDark] = useDarkMode();
  const uploadInputRef = useRef(null);

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

  async function handleDelete(id) {
    if (!confirm('Delete this project? This cannot be undone.')) return;
    await api.deleteProject(id);
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
    <div style={{ maxWidth: 720, margin: '40px auto', padding: '0 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo size={32} />
          Quireloop
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
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
        <button type="submit" style={{ padding: '8px 16px' }}>
          New Project
        </button>
      </form>

      {!showImport && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
          <button onClick={() => setShowImport(true)} style={{ fontSize: 13 }}>
            Import from the hosted editor…
          </button>
          <button onClick={() => uploadInputRef.current?.click()} disabled={uploading} style={{ fontSize: 13 }}>
            {uploading ? 'Uploading…' : 'Upload Project (.zip)…'}
          </button>
          <input ref={uploadInputRef} type="file" accept=".zip" onChange={handleUploadZip} style={{ display: 'none' }} />
          {uploadError && <span style={{ color: 'crimson', fontSize: 13 }}>{uploadError}</span>}
        </div>
      )}
      {showImport && <ImportFromthe hosted editor onClose={() => setShowImport(false)} onImported={handleImported} />}

      <div style={{ display: 'grid', gap: 12 }}>
        {projects.map((p) => (
          <div
            key={p.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 16,
              background: 'var(--panel-bg)',
              borderRadius: 8,
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}
          >
            <div onClick={() => onOpen(p.id)} style={{ cursor: 'pointer', flex: 1 }}>
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
                  Shared
                </span>
              )}
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Updated {new Date(p.updatedAt).toLocaleString()}
              </div>
            </div>
            <a href={api.downloadUrl(p.id)} download style={{ marginRight: 12, fontSize: 13 }}>
              Download .zip
            </a>
            {p.ownerId === user?.id && (
              <button onClick={() => handleDelete(p.id)} style={{ color: 'crimson' }}>
                Delete
              </button>
            )}
          </div>
        ))}
        {projects.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No projects yet.</p>}
      </div>
    </div>
  );
}
