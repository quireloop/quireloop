import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import FileTree from '../components/FileTree.jsx';
import Editor from '../components/Editor.jsx';
import PdfViewer from '../components/PdfViewer.jsx';
import CompileLogPanel from '../components/CompileLogPanel.jsx';
import OutlinePanel from '../components/OutlinePanel.jsx';
import SymbolPalette from '../components/SymbolPalette.jsx';
import VersionHistoryPanel from '../components/VersionHistoryPanel.jsx';
import Logo from '../components/Logo.jsx';
import { buildOutline, countWords } from '../lib/outline.js';
import { useDarkMode } from '../lib/theme.js';

const AUTOSAVE_DELAY_MS = 1200;

export default function ProjectView({ projectId, onBack }) {
  const [manifest, setManifest] = useState(null);
  const [activePath, setActivePath] = useState(null);
  const [content, setContent] = useState(null);
  const [initialLine, setInitialLine] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [compileResult, setCompileResult] = useState(null);
  const [compiling, setCompiling] = useState(false);
  const [sidebarTab, setSidebarTab] = useState('files');
  const [showSymbols, setShowSymbols] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState([]);
  const [dark, setDark] = useDarkMode();
  const dirtyContentRef = useRef('');
  const activePathRef = useRef(null);
  const autosaveTimerRef = useRef(null);
  const editorRef = useRef(null);
  const pdfViewerRef = useRef(null);

  activePathRef.current = activePath;

  useEffect(() => {
    api.getProject(projectId).then((m) => {
      setManifest(m);
      const textFile = m.files.find((f) => ['tex', 'bib', 'cls', 'sty'].includes(f.type));
      if (textFile) setActivePath(textFile.path);
    });
  }, [projectId]);

  useEffect(() => {
    if (!activePath) return;
    setContent(null);
    api.readFile(projectId, activePath).then((text) => {
      setContent(text);
      dirtyContentRef.current = text;
      setDirty(false);
    });
  }, [projectId, activePath]);

  useEffect(() => {
    function handleBeforeUnload(e) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  const outline = useMemo(() => buildOutline(content ?? ''), [content]);
  const wordCount = useMemo(() => countWords(content ?? ''), [content]);

  async function flushSave(path = activePathRef.current) {
    if (!path) return;
    clearTimeout(autosaveTimerRef.current);
    await api.writeFile(projectId, path, dirtyContentRef.current);
    setDirty(false);
  }

  function handleEditorChange(text) {
    dirtyContentRef.current = text;
    setDirty(true);
    clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      flushSave();
    }, AUTOSAVE_DELAY_MS);
  }

  async function handleSelectFile(f) {
    if (f.path === activePath) return;
    if (dirty) await flushSave();
    setInitialLine(null);
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
      setActivePath(next ? next.path : null);
      if (!next) setContent(null);
    }
  }

  async function handleCompile() {
    setCompiling(true);
    try {
      await flushSave();
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

  async function jumpToSource(file, line) {
    if (file === activePath) {
      editorRef.current?.goToLine(line);
    } else {
      if (dirty) await flushSave();
      setInitialLine(line);
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
    await flushSave();
    await api.saveVersion(projectId, label);
    await refreshVersions();
  }

  async function handleRestoreVersion(versionId) {
    await api.restoreVersion(projectId, versionId);
    const updated = await api.getProject(projectId);
    setManifest(updated);
    setPdfUrl(null);
    setCompileResult(null);
    const stillExists = updated.files.some((f) => f.path === activePath);
    const nextPath = stillExists
      ? activePath
      : updated.files.find((f) => ['tex', 'bib', 'cls', 'sty'].includes(f.type))?.path ?? null;
    if (nextPath === activePath) {
      // Force a re-fetch of content even though the path didn't change.
      setContent(null);
      const text = await api.readFile(projectId, nextPath);
      setContent(text);
      dirtyContentRef.current = text;
      setDirty(false);
    } else {
      setActivePath(nextPath);
    }
    await refreshVersions();
  }

  async function handleShowInPdf() {
    if (!activePath || !pdfUrl) return;
    const line = editorRef.current?.getCursorLine() ?? 1;
    try {
      const result = await api.synctexToPdf(projectId, activePath, line);
      pdfViewerRef.current?.scrollToPosition(result.page, result.x, result.y);
    } catch {
      // no synctex match for this position — ignore
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 8, borderBottom: '1px solid var(--border)' }}>
        <button onClick={onBack}>&larr; Back</button>
        <Logo size={20} />
        <strong>{manifest?.name}</strong>
        {dirty && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Unsaved changes…</span>}
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{wordCount} words</span>
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
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {sidebarTab === 'files' && manifest && (
              <FileTree
                files={manifest.files}
                activePath={activePath}
                dirty={dirty}
                onSelect={handleSelectFile}
                onUpload={handleUpload}
                onCreate={handleCreate}
                onCreateFolder={handleCreateFolder}
                onRename={handleRename}
                onDelete={handleDelete}
              />
            )}
            {sidebarTab === 'outline' && <OutlinePanel entries={outline} onJump={handleOutlineJump} />}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            {activePath && content !== null && (
              <Editor
                ref={editorRef}
                key={activePath}
                filePath={activePath}
                content={content}
                initialLine={initialLine}
                dark={dark}
                onChange={handleEditorChange}
                onSave={() => flushSave()}
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
        <div style={{ width: '45%', borderLeft: '1px solid var(--border)' }}>
          <PdfViewer ref={pdfViewerRef} url={pdfUrl} projectId={projectId} onJumpToSource={jumpToSource} />
        </div>
      </div>
    </div>
  );
}
