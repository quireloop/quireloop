import { useEffect, useMemo, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { api } from '../api.js';
import FileTree from '../components/FileTree.jsx';
import Editor from '../components/Editor.jsx';
import PdfViewer from '../components/PdfViewer.jsx';
import CompileLogPanel from '../components/CompileLogPanel.jsx';
import OutlinePanel from '../components/OutlinePanel.jsx';
import SymbolPalette from '../components/SymbolPalette.jsx';
import VersionHistoryPanel from '../components/VersionHistoryPanel.jsx';
import SourceControlPanel from '../components/SourceControlPanel.jsx';
import ShareModal from '../components/ShareModal.jsx';
import Logo from '../components/Logo.jsx';
import { buildOutline, countWords } from '../lib/outline.js';
import { useDarkMode, useSidebarOpen } from '../lib/theme.js';
import { parseBibEntries } from '../lib/bibtex.js';

const RECENT_EDITORS_POLL_MS = 8000;

const STATUS_LABEL = {
  connecting: 'Connecting…',
  connected: 'Connected — syncing…',
  syncing: 'Syncing…',
  synced: 'Synced',
  disconnected: 'Offline — changes saved locally',
};

export default function ProjectView({ projectId, onBack, user }) {
  const [manifest, setManifest] = useState(null);
  const [activePath, setActivePath] = useState(null);
  const [content, setContent] = useState('');
  const [collabStatus, setCollabStatus] = useState('connecting');
  const [recentEditors, setRecentEditors] = useState([]);
  const [initialLine, setInitialLine] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [compileResult, setCompileResult] = useState(null);
  const [compiling, setCompiling] = useState(false);
  const [sidebarTab, setSidebarTab] = useState('files');
  const [showSymbols, setShowSymbols] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [versions, setVersions] = useState([]);
  const [bibEntries, setBibEntries] = useState([]);
  const [dark, setDark] = useDarkMode();
  const [sidebarOpen, setSidebarOpen] = useSidebarOpen();
  const editorRef = useRef(null);
  const pdfViewerRef = useRef(null);

  useEffect(() => {
    api.getProject(projectId).then((m) => {
      setManifest(m);
      const textFile = m.files.find((f) => ['tex', 'bib', 'cls', 'sty'].includes(f.type));
      if (textFile) setActivePath(textFile.path);
    });
  }, [projectId]);

  // Powers \cite{} autocomplete — re-parsed whenever the project's file
  // list changes (a .bib was added, removed, or the active one saved a new
  // manifest entry). The file's own edits mid-session aren't picked up
  // until the next manifest refresh, which is fine for an autocomplete list.
  useEffect(() => {
    const bibFiles = (manifest?.files ?? []).filter((f) => f.type === 'bib');
    if (bibFiles.length === 0) {
      setBibEntries([]);
      return;
    }
    let cancelled = false;
    Promise.all(bibFiles.map((f) => api.readFile(projectId, f.path).catch(() => ''))).then((texts) => {
      if (!cancelled) setBibEntries(texts.flatMap(parseBibEntries));
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, manifest?.files]);

  // Attribution — who's recently touched the file currently open, polled
  // rather than pushed since it's a nice-to-have, not something that needs
  // to be instant.
  useEffect(() => {
    if (!activePath) {
      setRecentEditors([]);
      return;
    }
    let cancelled = false;
    function poll() {
      api
        .recentEditors(projectId, activePath)
        .then((list) => !cancelled && setRecentEditors(list))
        .catch(() => {});
    }
    poll();
    const timer = setInterval(poll, RECENT_EDITORS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId, activePath]);

  const outline = useMemo(() => buildOutline(content ?? ''), [content]);
  const wordCount = useMemo(() => countWords(content ?? ''), [content]);

  function handleEditorChange(text) {
    setContent(text);
  }

  function handleSelectFile(f) {
    if (f.path === activePath) return;
    setInitialLine(null);
    setContent('');
    setActivePath(f.path);
  }

  async function refreshManifest() {
    setManifest(await api.getProject(projectId));
  }

  async function handleUpload(file) {
    await api.uploadFile(projectId, file);
    await refreshManifest();
  }

  async function handleCreate(name) {
    await api.writeFile(projectId, name, '');
    await refreshManifest();
    setInitialLine(null);
    setContent('');
    setActivePath(name);
  }

  async function handleCreateFolder(path) {
    await api.createFolder(projectId, path);
    await refreshManifest();
  }

  async function handleRename(oldPath, newPath) {
    await api.renameFile(projectId, oldPath, newPath);
    await refreshManifest();
    if (oldPath === activePath) setActivePath(newPath);
  }

  async function handleDelete(path) {
    await api.deleteFile(projectId, path);
    const updated = await api.getProject(projectId);
    setManifest(updated);
    if (path === activePath) {
      const next = updated.files.find((f) => ['tex', 'bib', 'cls', 'sty'].includes(f.type));
      setContent('');
      setActivePath(next ? next.path : null);
    }
  }

  async function handleCompile() {
    setCompiling(true);
    try {
      const result = await api.compile(projectId);
      setCompileResult(result);
      if (result.success) {
        setPdfUrl(api.pdfUrl(projectId));
      }
    } finally {
      setCompiling(false);
    }
  }

  async function handleCompilerChange(compiler) {
    await api.setCompiler(projectId, compiler);
    await refreshManifest();
  }

  async function handleClean() {
    await api.clean(projectId);
    setPdfUrl(null);
  }

  function jumpToSource(file, line) {
    if (file === activePath) {
      editorRef.current?.goToLine(line);
    } else {
      setInitialLine(line);
      setContent('');
      setActivePath(file);
    }
  }

  function handleOutlineJump(line) {
    editorRef.current?.goToLine(line);
  }

  function handleInsertSnippet(text) {
    editorRef.current?.insertAtCursor(text);
  }

  async function refreshVersions() {
    setVersions(await api.listVersions(projectId));
  }

  function handleToggleHistory() {
    setShowHistory((v) => !v);
    if (!showHistory) refreshVersions();
  }

  async function handleSaveVersion(label) {
    await api.saveVersion(projectId, label);
    await refreshVersions();
  }

  async function handleRestoreVersion(versionId) {
    await api.restoreVersion(projectId, versionId);
    const updated = await api.getProject(projectId);
    setManifest(updated);
    setPdfUrl(null);
    setCompileResult(null);
    setContent('');
    const stillExists = updated.files.some((f) => f.path === activePath);
    const nextPath = stillExists
      ? activePath
      : updated.files.find((f) => ['tex', 'bib', 'cls', 'sty'].includes(f.type))?.path ?? null;
    setActivePath(nextPath);
    await refreshVersions();
  }

  async function jumpToPdfAtLine(line) {
    if (!activePath || !pdfUrl) return;
    try {
      const result = await api.synctexToPdf(projectId, activePath, line);
      pdfViewerRef.current?.scrollToPosition(result.page, result.x, result.y);
    } catch {
      // no synctex match for this position — ignore
    }
  }

  function handleShowInPdf() {
    return jumpToPdfAtLine(editorRef.current?.getCursorLine() ?? 1);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 8, borderBottom: '1px solid var(--border)' }}>
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          style={{ fontSize: 15, lineHeight: 1 }}
        >
          ☰
        </button>
        <button onClick={onBack}>&larr; Back</button>
        <Logo size={20} />
        <strong>{manifest?.name}</strong>
        <span style={{ color: collabStatus === 'disconnected' ? '#e0a030' : 'var(--text-muted)', fontSize: 12 }}>
          {STATUS_LABEL[collabStatus] ?? collabStatus}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{wordCount} words</span>
        {recentEditors.length > 0 && (
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }} title={recentEditors.map((e) => e.email).join(', ')}>
            👥 {recentEditors.map((e) => e.email.split('@')[0]).join(', ')}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
          <button
            onClick={() => setDark(!dark)}
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{ fontSize: 13 }}
          >
            {dark ? '☀ Light' : '🌙 Dark'}
          </button>
          <button onClick={() => setShowSymbols((v) => !v)} style={{ fontSize: 13 }}>
            Insert
          </button>
          {showSymbols && <SymbolPalette onInsert={handleInsertSnippet} onClose={() => setShowSymbols(false)} />}
          <button onClick={handleToggleHistory} style={{ fontSize: 13 }}>
            History
          </button>
          {showHistory && (
            <VersionHistoryPanel
              versions={versions}
              onSave={handleSaveVersion}
              onRestore={handleRestoreVersion}
              onClose={() => setShowHistory(false)}
            />
          )}
          {manifest && (
            <button onClick={() => setShowShare((v) => !v)} style={{ fontSize: 13 }}>
              Share
            </button>
          )}
          {showShare && manifest && (
            <ShareModal
              manifest={manifest}
              isOwner={manifest.ownerId === user?.id}
              onClose={() => setShowShare(false)}
              onUpdated={setManifest}
            />
          )}
          {manifest && (
            <select
              value={manifest.compiler ?? 'pdflatex'}
              onChange={(e) => handleCompilerChange(e.target.value)}
              style={{ fontSize: 13 }}
            >
              <option value="pdflatex">pdfLaTeX</option>
              <option value="xelatex">XeLaTeX</option>
              <option value="lualatex">LuaLaTeX</option>
            </select>
          )}
          <button onClick={handleClean} style={{ fontSize: 13 }}>
            Clean Aux Files
          </button>
          <a href={api.downloadUrl(projectId)} download style={{ fontSize: 13 }}>
            Download .zip
          </a>
          {pdfUrl && (
            <button onClick={handleShowInPdf} style={{ fontSize: 13 }}>
              Show in PDF
            </button>
          )}
          <button onClick={handleCompile} disabled={compiling} style={{ padding: '6px 16px' }}>
            {compiling ? 'Compiling…' : 'Compile'}
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {sidebarOpen && (
        <div style={{ width: 220, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
            <button
              onClick={() => setSidebarTab('files')}
              style={{
                flex: 1,
                border: 'none',
                borderRadius: 0,
                background: sidebarTab === 'files' ? 'var(--accent-bg)' : 'transparent',
                fontSize: 13,
                padding: 6,
              }}
            >
              Files
            </button>
            <button
              onClick={() => setSidebarTab('outline')}
              style={{
                flex: 1,
                border: 'none',
                borderRadius: 0,
                background: sidebarTab === 'outline' ? 'var(--accent-bg)' : 'transparent',
                fontSize: 13,
                padding: 6,
              }}
            >
              Outline
            </button>
            <button
              onClick={() => setSidebarTab('git')}
              style={{
                flex: 1,
                border: 'none',
                borderRadius: 0,
                background: sidebarTab === 'git' ? 'var(--accent-bg)' : 'transparent',
                fontSize: 13,
                padding: 6,
              }}
            >
              Source Control
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {sidebarTab === 'files' && manifest && (
              <FileTree
                files={manifest.files}
                activePath={activePath}
                onSelect={handleSelectFile}
                onUpload={handleUpload}
                onCreate={handleCreate}
                onCreateFolder={handleCreateFolder}
                onRename={handleRename}
                onDelete={handleDelete}
              />
            )}
            {sidebarTab === 'outline' && <OutlinePanel entries={outline} onJump={handleOutlineJump} />}
            {sidebarTab === 'git' && <SourceControlPanel projectId={projectId} />}
          </div>
        </div>
        )}
        <PanelGroup
          direction="horizontal"
          autoSaveId="quireloop-editor-pdf-split"
          style={{ flex: 1, minWidth: 0, minHeight: 0 }}
        >
          <Panel defaultSize={55} minSize={20}>
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, minHeight: 0 }}>
                {activePath && (
                  <Editor
                    ref={editorRef}
                    key={`${activePath}:${manifest?.collabGeneration ?? 0}`}
                    projectId={projectId}
                    filePath={activePath}
                    collabGeneration={manifest?.collabGeneration ?? 0}
                    initialLine={initialLine}
                    dark={dark}
                    user={user}
                    onChange={handleEditorChange}
                    onStatus={setCollabStatus}
                    onJumpToPdf={jumpToPdfAtLine}
                    bibEntries={bibEntries}
                  />
                )}
              </div>
              {compileResult && (
                <CompileLogPanel
                  log={compileResult.log}
                  success={compileResult.success}
                  onClose={() => setCompileResult(null)}
                  onJump={jumpToSource}
                />
              )}
            </div>
          </Panel>
          <PanelResizeHandle
            style={{
              width: 6,
              cursor: 'col-resize',
              background: 'var(--border)',
              flexShrink: 0,
            }}
          />
          <Panel defaultSize={45} minSize={15}>
            <PdfViewer ref={pdfViewerRef} url={pdfUrl} projectId={projectId} onJumpToSource={jumpToSource} />
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}
