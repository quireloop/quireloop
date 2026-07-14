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
import SearchPanel from '../components/SearchPanel.jsx';
import ShareModal from '../components/ShareModal.jsx';
import CommentsPanel from '../components/CommentsPanel.jsx';
import SuggestionsPanel from '../components/SuggestionsPanel.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import Logo from '../components/Logo.jsx';
import { buildOutline, countWords } from '../lib/outline.js';
import { useDarkMode, useSidebarOpen } from '../lib/theme.js';
import { parseBibEntries } from '../lib/bibtex.js';
import { encodeAnchor, decodeAnchor } from '../lib/commentAnchors.js';

const RECENT_EDITORS_POLL_MS = 8000;
const COMMENTS_POLL_MS = 8000;
const SUGGESTIONS_POLL_MS = 8000;
const CHAT_OPEN_POLL_MS = 4000;
const CHAT_CLOSED_POLL_MS = 15000;
const AUTO_COMPILE_IDLE_MS = 2500;
const AUTO_COMPILE_STORAGE_KEY = 'quireloop:autoCompile';
const SPELLCHECK_STORAGE_KEY = 'quireloop:spellcheck';
const VIM_MODE_STORAGE_KEY = 'quireloop:vimMode';
const SUGGEST_MODE_STORAGE_KEY = 'quireloop:suggestMode';

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

  // Auto-compile on idle — toggle persisted in localStorage, default off.
  // The debounce timer only fires on real edits: the ref below is set
  // whenever the open file changes so the doc-load-triggered content
  // update right after switching files (or opening the project) doesn't
  // itself count as an edit and kick off a compile.
  const [autoCompile, setAutoCompile] = useState(
    () => localStorage.getItem(AUTO_COMPILE_STORAGE_KEY) === 'true'
  );

  // Spell check (browser-native, toggled via a Compartment — see Editor's
  // setSpellcheck) and vim keybindings (toggled by remounting the editor,
  // simplest correct thing per Editor's [vimMode] effect dep). Both default
  // off and persist per-browser, same pattern as autoCompile above.
  const [spellcheck, setSpellcheck] = useState(
    () => localStorage.getItem(SPELLCHECK_STORAGE_KEY) === 'true'
  );
  const [vimMode, setVimMode] = useState(() => localStorage.getItem(VIM_MODE_STORAGE_KEY) === 'true');
  // Suggest mode ("track changes") — default off, persisted per-browser
  // like autoCompile/spellcheck/vimMode above. Only meaningful for roles
  // that can write; the toolbar toggle and its effect are hidden/no-ops
  // for viewers (see isViewer below).
  const [suggestMode, setSuggestMode] = useState(
    () => localStorage.getItem(SUGGEST_MODE_STORAGE_KEY) === 'true'
  );
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const autoCompileRef = useRef(autoCompile);
  const compilingRef = useRef(false);
  const activePathRef = useRef(activePath);
  const skipNextContentChangeRef = useRef(true);
  const autoCompileTimerRef = useRef(null);
  const pendingAutoCompileRef = useRef(false);

  // Comments — collabHandles is the { ydoc, ytext, view } trio Editor hands
  // up once its Yjs doc exists, needed to encode/decode the relative-
  // position anchors comment threads are attached to.
  const [collabHandles, setCollabHandles] = useState(null);
  const [selectionNonEmpty, setSelectionNonEmpty] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showResolvedComments, setShowResolvedComments] = useState(false);
  const [commentThreads, setCommentThreads] = useState([]);

  // Chat — unread count is derived from a per-project "last seen message
  // id" kept in localStorage so it survives a page reload.
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [unreadChat, setUnreadChat] = useState(0);
  const lastSeenChatIdRef = useRef(localStorage.getItem(`quireloop:chat-seen:${projectId}`) || null);

  useEffect(() => {
    api.getProject(projectId).then((m) => {
      setManifest(m);
      const textFile = m.files.find((f) => ['tex', 'bib', 'cls', 'sty'].includes(f.type));
      if (textFile) setActivePath(textFile.path);
    });
  }, [projectId]);

  useEffect(() => {
    localStorage.setItem(AUTO_COMPILE_STORAGE_KEY, String(autoCompile));
    autoCompileRef.current = autoCompile;
  }, [autoCompile]);

  useEffect(() => {
    localStorage.setItem(SPELLCHECK_STORAGE_KEY, String(spellcheck));
    editorRef.current?.setSpellcheck(spellcheck);
  }, [spellcheck]);

  useEffect(() => {
    localStorage.setItem(VIM_MODE_STORAGE_KEY, String(vimMode));
  }, [vimMode]);

  useEffect(() => {
    localStorage.setItem(SUGGEST_MODE_STORAGE_KEY, String(suggestMode));
    editorRef.current?.setSuggestMode(suggestMode);
  }, [suggestMode]);

  useEffect(() => {
    activePathRef.current = activePath;
    // The next content update for the newly-opened file is the doc
    // loading in, not a user edit — don't let it start the idle timer.
    skipNextContentChangeRef.current = true;
  }, [activePath]);

  // Idle-triggered auto-compile: debounce every content change, and if a
  // compile is already in flight when the timer fires, remember to run
  // one more once it finishes rather than dropping the edit on the floor.
  useEffect(() => {
    if (skipNextContentChangeRef.current) {
      skipNextContentChangeRef.current = false;
      return;
    }
    if (!autoCompileRef.current) return;
    if (autoCompileTimerRef.current) clearTimeout(autoCompileTimerRef.current);
    autoCompileTimerRef.current = setTimeout(() => {
      if (compilingRef.current) {
        pendingAutoCompileRef.current = true;
      } else {
        handleCompile();
      }
    }, AUTO_COMPILE_IDLE_MS);
    return () => {
      if (autoCompileTimerRef.current) clearTimeout(autoCompileTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  // Re-apply the last compile's problems to the editor whenever the open
  // file changes (Editor remounts per file, so its diagnostics reset).
  useEffect(() => {
    if (!compileResult) return;
    applyDiagnosticsToEditor(compileResult.problems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, compileResult]);

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

  // Comment threads for the open file — polled so collaborators see new
  // comments/replies without a refresh, same pattern as recentEditors above.
  useEffect(() => {
    if (!activePath) {
      setCommentThreads([]);
      return;
    }
    let cancelled = false;
    function poll() {
      api
        .listComments(projectId, activePath)
        .then((list) => !cancelled && setCommentThreads(list))
        .catch(() => {});
    }
    poll();
    const timer = setInterval(poll, COMMENTS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId, activePath]);

  // Suggestion records for the open file — polled the same way as
  // comments so collaborators see new/accepted/rejected suggestions
  // without a refresh.
  useEffect(() => {
    if (!activePath) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    function poll() {
      api
        .listSuggestions(projectId, activePath)
        .then((list) => !cancelled && setSuggestions(list))
        .catch(() => {});
    }
    poll();
    const timer = setInterval(poll, SUGGESTIONS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId, activePath]);

  // Decode each thread's Yjs relative-position anchor against the live doc
  // and push the resulting ranges into the editor as highlight decorations
  // — recomputed whenever the thread list changes or the doc's content
  // changes (cheap: relative positions resolve in O(1) against the doc).
  useEffect(() => {
    if (!collabHandles) return;
    const ranges = commentThreads
      .map((t) => {
        const range = decodeAnchor(collabHandles.ydoc, t.anchor);
        return range && { ...range, resolved: t.resolved };
      })
      .filter(Boolean);
    editorRef.current?.setCommentRanges(ranges);
  }, [collabHandles, commentThreads, content]);

  // Same decode as comments above, but for pending suggestions: resolves
  // each anchor to a live range, reads the anchored text straight out of
  // `content` (kept in sync with the doc by Editor's onChange), and drops
  // — rather than flagging as orphaned — any suggestion whose anchor no
  // longer resolves, per the design (an insert suggestion whose range
  // vanished has nothing left to accept/reject; same for a delete
  // suggestion whose range was itself deleted by someone else).
  const suggestionsWithText = useMemo(() => {
    if (!collabHandles) return [];
    return suggestions
      .map((s) => {
        const range = decodeAnchor(collabHandles.ydoc, s.anchor);
        if (!range) return null;
        return { ...s, from: range.from, to: range.to, text: content.slice(range.from, range.to) };
      })
      .filter(Boolean);
  }, [suggestions, collabHandles, content]);

  // Push the resolved suggestion ranges into the editor as decorations —
  // same pattern as the comment-highlight effect above.
  useEffect(() => {
    if (!collabHandles) return;
    editorRef.current?.setSuggestionRanges(
      suggestionsWithText.map((s) => ({ from: s.from, to: s.to, type: s.type }))
    );
  }, [collabHandles, suggestionsWithText]);

  // Chat — polls faster while the panel is open (so an active conversation
  // feels live) and slower while closed (just enough to keep the unread
  // badge current).
  useEffect(() => {
    let cancelled = false;
    function poll() {
      api
        .listChat(projectId, null)
        .then((list) => {
          if (cancelled) return;
          setChatMessages(list);
          if (!showChat && list.length > 0) {
            const lastSeen = lastSeenChatIdRef.current;
            const idx = lastSeen ? list.findIndex((m) => m.id === lastSeen) : -1;
            setUnreadChat(idx === -1 ? list.length : list.length - idx - 1);
          }
        })
        .catch(() => {});
    }
    poll();
    const timer = setInterval(poll, showChat ? CHAT_OPEN_POLL_MS : CHAT_CLOSED_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId, showChat]);

  useEffect(() => {
    if (showChat && chatMessages.length > 0) {
      const lastId = chatMessages[chatMessages.length - 1].id;
      lastSeenChatIdRef.current = lastId;
      localStorage.setItem(`quireloop:chat-seen:${projectId}`, lastId);
      setUnreadChat(0);
    }
  }, [showChat, chatMessages, projectId]);

  const isViewer = manifest?.yourRole === 'viewer';
  const isOwner = manifest?.ownerId === user?.id;

  // Flags a thread as "orphaned" once its anchor can no longer be resolved
  // against the live doc (the commented text was deleted) — same decode
  // used for the editor highlight decorations above.
  const commentThreadsWithStatus = useMemo(() => {
    if (!collabHandles) return commentThreads.map((t) => ({ ...t, orphaned: false }));
    return commentThreads.map((t) => ({ ...t, orphaned: !decodeAnchor(collabHandles.ydoc, t.anchor) }));
  }, [commentThreads, collabHandles, content]);

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

  // Maps the compile's flat problem list down to the currently-open file
  // and pushes it into the editor as diagnostics; called both right after
  // a compile finishes and whenever the open file changes.
  function applyDiagnosticsToEditor(problems) {
    const forFile = (problems ?? []).filter((p) => p.file === activePathRef.current);
    editorRef.current?.setDiagnostics(forFile);
  }

  async function handleCompile() {
    setCompiling(true);
    compilingRef.current = true;
    editorRef.current?.setDiagnostics([]);
    try {
      const result = await api.compile(projectId);
      setCompileResult(result);
      applyDiagnosticsToEditor(result.problems);
      if (result.success) {
        setPdfUrl(api.pdfUrl(projectId));
      }
    } finally {
      setCompiling(false);
      compilingRef.current = false;
      if (pendingAutoCompileRef.current) {
        pendingAutoCompileRef.current = false;
        if (autoCompileRef.current) handleCompile();
      }
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

  async function refreshComments() {
    if (!activePath) return;
    setCommentThreads(await api.listComments(projectId, activePath));
  }

  async function handleCreateComment() {
    const view = collabHandles?.view;
    const ytext = collabHandles?.ytext;
    if (!view || !ytext) return;
    const { from, to } = view.state.selection.main;
    if (from === to) return;
    const text = prompt('Comment:');
    if (!text || !text.trim()) return;
    const anchor = encodeAnchor(ytext, from, to);
    await api.createComment(projectId, activePath, anchor, text.trim());
    await refreshComments();
    setShowComments(true);
  }

  function handleSelectThread(thread) {
    if (!collabHandles) return;
    const range = decodeAnchor(collabHandles.ydoc, thread.anchor);
    if (!range) return;
    editorRef.current?.selectRange(range.from, range.to);
  }

  async function handleReplyComment(threadId, text) {
    await api.replyToComment(projectId, threadId, text);
    await refreshComments();
  }

  async function handleResolveComment(threadId, resolved) {
    await api.resolveComment(projectId, threadId, resolved);
    await refreshComments();
  }

  async function handleDeleteComment(threadId) {
    if (!confirm('Delete this comment thread?')) return;
    await api.deleteComment(projectId, threadId);
    await refreshComments();
  }

  async function refreshSuggestions() {
    if (!activePath) return;
    setSuggestions(await api.listSuggestions(projectId, activePath));
  }

  // Fired by Editor whenever suggest mode rewrites a user edit into a
  // pending suggestion — see the transactionFilter/updateListener pair in
  // Editor.jsx for why this arrives post-sync (ytext already has the
  // edit, so encodeAnchor's indices are valid).
  async function handleSuggestedChange(change) {
    const ytext = collabHandles?.ytext;
    if (!ytext || !activePath) return;
    const anchor = encodeAnchor(ytext, change.from, change.to);
    await api.createSuggestion(projectId, activePath, change.type, anchor);
    await refreshSuggestions();
  }

  // After an accept/reject edits the doc, other pending suggestions whose
  // anchored text was inside the removed range collapse to empty — e.g.
  // accepting a deletion that covered someone's pending insertion. Their
  // records would linger forever (nothing left to highlight or act on),
  // so sweep away any same-file record whose anchor no longer spans text.
  // Only called right after our own doc edit, never from the poll: decode
  // uses THIS file's ydoc, so records for other files would always look
  // dead from here.
  async function sweepOrphanedSuggestions() {
    if (!collabHandles || !activePath) return;
    const list = await api.listSuggestions(projectId, activePath);
    const stale = list.filter((s) => {
      const r = decodeAnchor(collabHandles.ydoc, s.anchor);
      return !r || r.from >= r.to;
    });
    await Promise.all(stale.map((s) => api.deleteSuggestion(projectId, s.id).catch(() => {})));
  }

  // Accept/reject both re-decode the anchor immediately before touching
  // the doc, in case it went stale between the panel rendering and the
  // button click (someone else edited nearby, or resolved it already).
  async function handleAcceptSuggestion(suggestion) {
    const range = collabHandles ? decodeAnchor(collabHandles.ydoc, suggestion.anchor) : null;
    if (range && suggestion.type === 'delete') {
      // Accepting a deletion actually removes the anchored text.
      editorRef.current?.replaceRange(range.from, range.to, '');
    }
    // Accepting an insertion just un-marks it — the text is already live.
    await api.deleteSuggestion(projectId, suggestion.id);
    await sweepOrphanedSuggestions();
    await refreshSuggestions();
  }

  async function handleRejectSuggestion(suggestion) {
    const range = collabHandles ? decodeAnchor(collabHandles.ydoc, suggestion.anchor) : null;
    if (range && suggestion.type === 'insert') {
      // Rejecting an insertion removes the text that was staged.
      editorRef.current?.replaceRange(range.from, range.to, '');
    }
    // Rejecting a deletion just un-marks it — the text was never removed.
    await api.deleteSuggestion(projectId, suggestion.id);
    await sweepOrphanedSuggestions();
    await refreshSuggestions();
  }

  async function handleSendChat(text) {
    const message = await api.sendChat(projectId, text);
    setChatMessages((list) => [...list, message]);
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
        {isViewer && (
          <span
            title="You have view-only access to this project"
            style={{
              fontSize: 11,
              padding: '2px 6px',
              borderRadius: 4,
              background: 'var(--accent-bg)',
              color: 'var(--text-muted)',
            }}
          >
            Read-only
          </span>
        )}
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
          <button
            onClick={() => setSpellcheck((v) => !v)}
            title={
              spellcheck
                ? 'Browser spell check is on — uses your OS/browser dictionary, so it will flag LaTeX commands too'
                : 'Browser spell check is off'
            }
            style={{ fontSize: 13, background: spellcheck ? 'var(--accent-bg)' : undefined }}
          >
            Aa
          </button>
          <button
            onClick={() => setVimMode((v) => !v)}
            title={vimMode ? 'Vim keybindings are on' : 'Vim keybindings are off'}
            style={{ fontSize: 13, background: vimMode ? 'var(--accent-bg)' : undefined }}
          >
            Vim
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
              projectId={projectId}
              versions={versions}
              files={manifest?.files ?? []}
              readOnly={isViewer}
              onSave={handleSaveVersion}
              onRestore={handleRestoreVersion}
              onClose={() => setShowHistory(false)}
            />
          )}
          {!isViewer && (
            <button
              onClick={() => setSuggestMode((v) => !v)}
              title={
                suggestMode
                  ? 'Suggest mode is on — your edits become pending suggestions others can accept or reject'
                  : 'Suggest mode is off — edits apply directly'
              }
              style={{ fontSize: 13, background: suggestMode ? 'var(--accent-bg)' : undefined }}
            >
              ✏ Suggest
            </button>
          )}
          <button
            onClick={() => setShowSuggestions((v) => !v)}
            style={{ fontSize: 13, background: showSuggestions ? 'var(--accent-bg)' : undefined }}
          >
            Suggestions{suggestions.length > 0 ? ` (${suggestions.length})` : ''}
          </button>
          <button
            onClick={handleCreateComment}
            disabled={!selectionNonEmpty}
            title={selectionNonEmpty ? 'Comment on the selected text' : 'Select some text to comment on it'}
            style={{ fontSize: 13 }}
          >
            💬 Comment
          </button>
          <button
            onClick={() => setShowComments((v) => !v)}
            style={{ fontSize: 13, background: showComments ? 'var(--accent-bg)' : undefined }}
          >
            Comments{commentThreads.filter((t) => !t.resolved).length > 0 ? ` (${commentThreads.filter((t) => !t.resolved).length})` : ''}
          </button>
          <button
            onClick={() => setShowChat((v) => !v)}
            style={{ fontSize: 13, background: showChat ? 'var(--accent-bg)' : undefined, position: 'relative' }}
          >
            Chat
            {unreadChat > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  background: '#d64545',
                  color: 'white',
                  borderRadius: 8,
                  fontSize: 10,
                  padding: '1px 5px',
                  lineHeight: 1.4,
                }}
              >
                {unreadChat}
              </span>
            )}
          </button>
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
              disabled={isViewer}
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
          <button
            onClick={() => setAutoCompile((v) => !v)}
            title={
              autoCompile
                ? 'Auto-compile is on — compiles automatically after edits settle'
                : 'Auto-compile is off — click Compile manually'
            }
            style={{ fontSize: 13, background: autoCompile ? 'var(--accent-bg)' : undefined }}
          >
            Auto
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
            <button
              onClick={() => setSidebarTab('search')}
              style={{
                flex: 1,
                border: 'none',
                borderRadius: 0,
                background: sidebarTab === 'search' ? 'var(--accent-bg)' : 'transparent',
                fontSize: 13,
                padding: 6,
              }}
            >
              Search
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {sidebarTab === 'files' && manifest && (
              <FileTree
                files={manifest.files}
                activePath={activePath}
                readOnly={isViewer}
                onSelect={handleSelectFile}
                onUpload={handleUpload}
                onCreate={handleCreate}
                onCreateFolder={handleCreateFolder}
                onRename={handleRename}
                onDelete={handleDelete}
              />
            )}
            {sidebarTab === 'outline' && <OutlinePanel entries={outline} onJump={handleOutlineJump} />}
            {sidebarTab === 'git' && <SourceControlPanel projectId={projectId} readOnly={isViewer} />}
            {sidebarTab === 'search' && <SearchPanel projectId={projectId} onJump={jumpToSource} />}
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
                    readOnly={isViewer}
                    spellcheck={spellcheck}
                    vimMode={vimMode}
                    suggestMode={suggestMode && !isViewer}
                    onChange={handleEditorChange}
                    onStatus={setCollabStatus}
                    onJumpToPdf={jumpToPdfAtLine}
                    bibEntries={bibEntries}
                    onCollabHandles={setCollabHandles}
                    onSelectionChange={setSelectionNonEmpty}
                    onSuggestedChange={handleSuggestedChange}
                  />
                )}
              </div>
              {compileResult && (
                <CompileLogPanel
                  log={compileResult.log}
                  success={compileResult.success}
                  problems={compileResult.problems}
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
        {showComments && (
          <CommentsPanel
            threads={commentThreadsWithStatus}
            showResolved={showResolvedComments}
            onToggleShowResolved={() => setShowResolvedComments((v) => !v)}
            currentUserId={user?.id}
            isOwner={isOwner}
            onSelectThread={handleSelectThread}
            onReply={handleReplyComment}
            onResolve={handleResolveComment}
            onDelete={handleDeleteComment}
            onClose={() => setShowComments(false)}
          />
        )}
        {showSuggestions && (
          <SuggestionsPanel
            suggestions={suggestionsWithText}
            canWrite={!isViewer}
            onAccept={handleAcceptSuggestion}
            onReject={handleRejectSuggestion}
            onClose={() => setShowSuggestions(false)}
          />
        )}
        {showChat && (
          <ChatPanel
            messages={chatMessages}
            currentUserId={user?.id}
            onSend={handleSendChat}
            onClose={() => setShowChat(false)}
          />
        )}
      </div>
    </div>
  );
}
