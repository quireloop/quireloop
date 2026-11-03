import { useEffect, useMemo, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { api, linkApi } from '../api.js';
import { BASE_PATH } from '../basePath.js';
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
import AssistantPanel from '../components/AssistantPanel.jsx';
import Logo from '../components/Logo.jsx';
import ToolbarMenu, { MenuItem } from '../components/ToolbarMenu.jsx';
import SlidePanel from '../components/SlidePanel.jsx';
import CommandPalette from '../components/CommandPalette.jsx';
import { BackIcon, SearchIcon, SidebarIcon } from '../components/Icons.jsx';
import { confirmDialog, promptDialog } from '../lib/dialog.js';
import { buildOutline, countWords } from '../lib/outline.js';
import { useTheme, useSidebarOpen } from '../lib/theme.js';
import { parseBibEntries } from '../lib/bibtex.js';
import { collectMacros } from '../lib/editorExtras.js';
import { encodeAnchor, decodeAnchor } from '../lib/commentAnchors.js';

const RECENT_EDITORS_POLL_MS = 8000;
const COMMENTS_POLL_MS = 8000;
const SUGGESTIONS_POLL_MS = 8000;
const CHAT_OPEN_POLL_MS = 4000;
const CHAT_CLOSED_POLL_MS = 15000;
const AUTO_COMPILE_IDLE_MS = 2500;
const AUTO_COMPILE_STORAGE_KEY = 'quireloop:autoCompile';
const SPELLCHECK_STORAGE_KEY = 'quireloop:spellcheck';
const GRAMMAR_STORAGE_KEY = 'quireloop:grammar';
const VIM_MODE_STORAGE_KEY = 'quireloop:vimMode';
const SUGGEST_MODE_STORAGE_KEY = 'quireloop:suggestMode';

const STATUS_LABEL = {
  connecting: 'Connecting…',
  connected: 'Syncing…',
  syncing: 'Syncing…',
  synced: 'Saved',
  disconnected: 'Offline — changes saved locally',
};

const SYNC_LABEL = {
  online: 'Synced with server',
  offline: 'Offline — will sync when the server is back',
  error: 'Sync problem — see your projects page',
  'reconnect-needed': 'Connect to the server again',
};

const SIDEBAR_TABS = [
  ['files', 'Files'],
  ['outline', 'Outline'],
  ['git', 'Git'],
  ['search', 'Search'],
];

const THEME_LABEL = {
  light: { name: 'Light', icon: '☀' },
  dark: { name: 'Dark', icon: '🌙' },
  neon: { name: 'Neon', icon: '⚡' },
};
const NEXT_THEME_NAME = { light: 'dark', dark: 'neon', neon: 'light' };

export default function ProjectView({ projectId, onBack, user }) {
  const [manifest, setManifest] = useState(null);
  const [activePath, setActivePath] = useState(null);
  const [content, setContent] = useState('');
  const [collabStatus, setCollabStatus] = useState('connecting');
  const [syncState, setSyncState] = useState(null);
  const [recentEditors, setRecentEditors] = useState([]);
  const [initialLine, setInitialLine] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [compileResult, setCompileResult] = useState(null);
  const [showLogPanel, setShowLogPanel] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [sidebarTab, setSidebarTab] = useState('files');
  const [showSymbols, setShowSymbols] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [versions, setVersions] = useState([]);
  const [bibEntries, setBibEntries] = useState([]);
  const [theme, cycleTheme] = useTheme();
  const [sidebarOpen, setSidebarOpen] = useSidebarOpen();
  const sidebarPanelRef = useRef(null);
  const [draggingSplit, setDraggingSplit] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const editorRef = useRef(null);
  const pdfViewerRef = useRef(null);
  const handleCompileRef = useRef(() => {});

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
  const [showAssistant, setShowAssistant] = useState(false);
  const [grammarAvailable, setGrammarAvailable] = useState(false);
  const [grammar, setGrammar] = useState(() => localStorage.getItem(GRAMMAR_STORAGE_KEY) === 'true');
  const [textCopied, setTextCopied] = useState(false);

  useEffect(() => {
    api.grammarConfig().then((cfg) => setGrammarAvailable(cfg.enabled)).catch(() => {});
  }, []);
  // Only a copy of a server paper has a sync state to show.
  useEffect(() => {
    if (!manifest?.sync) return undefined;
    const poll = () =>
      linkApi
        .status()
        .then((status) => setSyncState(status.state))
        .catch(() => setSyncState(null));
    poll();
    const timer = setInterval(poll, 5000);
    return () => clearInterval(timer);
  }, [manifest?.sync]);

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
    localStorage.setItem(GRAMMAR_STORAGE_KEY, String(grammar));
    editorRef.current?.setGrammar(grammar && grammarAvailable);
  }, [grammar, grammarAvailable]);

  // For pasting into a writing tool outside Quireloop, which would otherwise
  // trip over every LaTeX command.
  async function copyPlainText() {
    const source = editorRef.current?.getText?.() ?? '';
    const { text } = await api.plainText(projectId, source);
    await navigator.clipboard.writeText(text);
    setTextCopied(true);
    setTimeout(() => setTextCopied(false), 1500);
  }

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
  const problemCount = (compileResult?.problems ?? []).length;

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

  async function handleDeleteMany(paths) {
    const updated = await api.deleteFiles(projectId, paths);
    setManifest(updated);
    if (activePath && !updated.files.some((f) => f.path === activePath)) {
      const next = updated.files.find((f) => ['tex', 'bib', 'cls', 'sty'].includes(f.type));
      setContent('');
      setActivePath(next ? next.path : null);
    }
  }

  // After a pull, the manifest (file list) needs a fresh fetch — the
  // collab server already invalidates any live room for the currently-open
  // file so its content updates on its own via the websocket reconnecting,
  // but if that file was removed by the pull entirely we still need to
  // fall back to another one, same as a manual delete.
  async function handlePulled() {
    const updated = await api.getProject(projectId);
    setManifest(updated);
    if (activePath && !updated.files.some((f) => f.path === activePath)) {
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

  handleCompileRef.current = handleCompile;

  // Cmd+S (or Ctrl+S on Windows/Linux) compiles instead of triggering the
  // browser's "Save page" dialog — collaborative edits are already saved
  // continuously via Yjs, so "save" here means "give me a fresh PDF".
  // Cmd/Ctrl+Enter does the same.
  useEffect(() => {
    function onKeyDown(e) {
      const mod = e.metaKey || e.ctrlKey;
      const isCompileShortcut = mod && (e.key.toLowerCase() === 's' || (e.key === 'Enter' && !e.altKey));
      if (!isCompileShortcut) return;
      e.preventDefault();
      if (compilingRef.current) return;
      handleCompileRef.current();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // The sidebar is a real panel, so hiding it collapses it rather than removing
  // it, and any way of collapsing it (the button, dragging) lands in one state.
  useEffect(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    if (sidebarOpen) panel.expand();
    else panel.collapse();
  }, [sidebarOpen]);

  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        setShowPalette((v) => !v);
      }
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  async function handleCompilerChange(compiler) {
    await api.setCompiler(projectId, compiler);
    await refreshManifest();
  }

  async function handleClean() {
    await api.clean(projectId);
    setPdfUrl(null);
  }

  // `hint.word` comes from a PDF double-click: the editor lands on that word
  // when it is on or near the line, instead of the start of the line.
  function jumpToSource(file, line, hint) {
    const target = hint?.word ? { line, word: hint.word } : line;
    if (file === activePath) {
      if (hint) editorRef.current?.revealSource(target);
      else editorRef.current?.goToLine(line);
    } else {
      setInitialLine(target);
      setContent('');
      setActivePath(file);
    }
  }

  // Pasted screenshots and dropped image files: upload each into figures/
  // under a name that can't overwrite an existing file (every clipboard
  // paste is called "image.png"), then insert a figure block where the
  // paste or drop happened.
  async function handleImageFiles(files, pos) {
    if (isViewer) return;
    const taken = new Set((manifest?.files ?? []).map((f) => f.path));
    const blocks = [];
    for (const original of files) {
      const ext = (original.name.match(/\.[A-Za-z0-9]+$/)?.[0] ?? `.${original.type.split('/')[1] || 'png'}`).toLowerCase();
      const isClipboardPaste = /^image\.\w+$/i.test(original.name) || !original.name;
      const stem = isClipboardPaste
        ? `pasted-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`
        : original.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'figure';
      let name = `${stem}${ext}`;
      for (let i = 2; taken.has(`figures/${name}`); i++) name = `${stem}-${i}${ext}`;
      taken.add(`figures/${name}`);
      const file = new File([original], name, { type: original.type });
      const uploaded = await api.uploadFile(projectId, file);
      const label = stem.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
      blocks.push(
        [
          '\\begin{figure}[htbp]',
          '  \\centering',
          `  \\includegraphics[width=0.8\\linewidth]{${uploaded.path}}`,
          '  \\caption{}',
          `  \\label{fig:${label}}`,
          '\\end{figure}',
        ].join('\n')
      );
    }
    if (blocks.length > 0) editorRef.current?.replaceRange(pos, pos, `\n${blocks.join('\n\n')}\n`);
    await refreshManifest();
  }

  // User macros for the equation hover preview come from the main file's
  // preamble (where \newcommand usually lives), refreshed on each compile
  // and whenever the main file changes; the open file's own definitions are
  // merged in by the editor itself.
  const mainMacrosRef = useRef({});
  const mainFile = manifest?.mainFile;
  useEffect(() => {
    if (!mainFile) return;
    let cancelled = false;
    api
      .readFile(projectId, mainFile)
      .then((res) => {
        if (cancelled) return;
        const text = typeof res === 'string' ? res : res?.content ?? '';
        mainMacrosRef.current = collectMacros(text);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, mainFile, compileResult]);

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
    const text = await promptDialog({ title: 'Add a comment', confirmLabel: 'Comment', multiline: true });
    if (!text) return;
    const anchor = encodeAnchor(ytext, from, to);
    await api.createComment(projectId, activePath, anchor, text);
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
    const confirmed = await confirmDialog({ title: 'Delete this comment thread?', confirmLabel: 'Delete', danger: true });
    if (!confirmed) return;
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

  async function jumpToPdfAtLine(line, word) {
    if (!activePath || !pdfUrl) return;
    try {
      const result = await api.synctexToPdf(projectId, activePath, line);
      pdfViewerRef.current?.showSyncResult(result, word);
    } catch {
      // no synctex match for this position — ignore
    }
  }

  function handleShowInPdf() {
    return jumpToPdfAtLine(editorRef.current?.getCursorLine() ?? 1, editorRef.current?.getCursorWord());
  }

  const commands = [
    { id: 'compile', label: 'Compile', hint: 'Ctrl Enter', run: handleCompile },
    ...(pdfUrl ? [{ id: 'show-in-pdf', label: 'Show in PDF', hint: 'Ctrl Alt J', run: handleShowInPdf }] : []),
    { id: 'sidebar', label: sidebarOpen ? 'Hide sidebar' : 'Show sidebar', run: () => setSidebarOpen((v) => !v) },
    ...SIDEBAR_TABS.map(([id, label]) => ({
      id: `tab-${id}`,
      label: `Go to ${label}`,
      run: () => {
        setSidebarOpen(true);
        setSidebarTab(id);
      },
    })),
    ...(manifest ? [{ id: 'share', label: 'Share', run: () => setShowShare(true) }] : []),
    { id: 'history', label: 'Version history', run: handleToggleHistory },
    ...(compileResult ? [{ id: 'logs', label: 'Compile log', run: () => setShowLogPanel((v) => !v) }] : []),
    { id: 'comments', label: 'Comments', run: () => setShowComments((v) => !v) },
    { id: 'suggestions', label: 'Suggestions', run: () => setShowSuggestions((v) => !v) },
    { id: 'chat', label: 'Chat', run: () => setShowChat((v) => !v) },
    { id: 'symbols', label: 'Insert symbol', run: () => setShowSymbols((v) => !v) },
    { id: 'auto', label: `${autoCompile ? 'Turn off' : 'Turn on'} auto-compile`, run: () => setAutoCompile((v) => !v) },
    { id: 'theme', label: 'Change theme', run: cycleTheme },
    { id: 'back', label: 'All projects', run: onBack },
    ...(manifest?.files ?? [])
      .map((f) => ({ id: `file-${f.path}`, label: f.path, run: () => handleSelectFile(f) })),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div className="workspace-toolbar">
        <button
          className="icon-button"
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        >
          <SidebarIcon />
        </button>
        <button className="icon-button" onClick={onBack} title="All projects" aria-label="All projects">
          <BackIcon />
        </button>
        <strong className="workspace-title" title={manifest?.name}>
          {manifest?.name}
        </strong>
        <span className={`status-pill ${collabStatus}`} title={STATUS_LABEL[collabStatus] ?? collabStatus}>
          <i />
          <span>{STATUS_LABEL[collabStatus] ?? collabStatus}</span>
        </span>
        {syncState && SYNC_LABEL[syncState] && (
          <span className={`status-pill ${syncState === 'online' ? 'synced' : ''}`}>
            <i />
            <span>{SYNC_LABEL[syncState]}</span>
          </span>
        )}
        {isViewer && (
          <span className="status-pill" title="You have view-only access to this project">
            Read-only
          </span>
        )}
        <span className="toolbar-note">{wordCount} words</span>
        {recentEditors.length > 0 && (
          <span className="toolbar-note" title={recentEditors.map((e) => e.email).join(', ')}>
            {recentEditors.map((e) => e.email.split('@')[0]).join(', ')}
          </span>
        )}
        <div className="toolbar-actions">
          <button className="palette-trigger" onClick={() => setShowPalette(true)} title="Search commands and files">
            <SearchIcon />
            <kbd>{navigator.platform.startsWith('Mac') ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
          <ToolbarMenu label="Menu">
            {manifest && (
              <MenuItem onClick={() => setShowShare((v) => !v)} active={showShare}>
                Share
              </MenuItem>
            )}
            <MenuItem onClick={() => setAutoCompile((v) => !v)} active={autoCompile} title="Compiles automatically after edits settle">
              Auto-compile
            </MenuItem>
            {manifest && (
              <div style={{ padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)' }}>Compiler</span>
                <select
                  value={manifest.compiler ?? 'pdflatex'}
                  onChange={(e) => handleCompilerChange(e.target.value)}
                  disabled={isViewer}
                  style={{ fontSize: 13, flex: 1 }}
                >
                  <option value="pdflatex">pdfLaTeX</option>
                  <option value="xelatex">XeLaTeX</option>
                  <option value="lualatex">LuaLaTeX</option>
                </select>
              </div>
            )}
            <MenuItem onClick={handleClean}>Clean aux files</MenuItem>
            <a
              href={api.downloadUrl(projectId)}
              download
              style={{ fontSize: 13, padding: '7px 10px', borderRadius: 'var(--radius-sm)' }}
            >
              Download .zip
            </a>
          </ToolbarMenu>
          {showShare && manifest && (
            <ShareModal
              manifest={manifest}
              isOwner={manifest.ownerId === user?.id}
              onClose={() => setShowShare(false)}
              onUpdated={setManifest}
            />
          )}

          <ToolbarMenu
            label="Edit"
            badge={
              (commentThreads.filter((t) => !t.resolved).length > 0 ? 1 : 0) +
              (suggestions.length > 0 ? 1 : 0) +
              (unreadChat > 0 ? 1 : 0)
            }
          >
            <MenuItem
              onClick={() => setSpellcheck((v) => !v)}
              active={spellcheck}
              title="Uses your OS/browser dictionary, so it will flag LaTeX commands too"
            >
              Spell check
            </MenuItem>
            {grammarAvailable && (
              <MenuItem
                onClick={() => setGrammar((v) => !v)}
                active={grammar}
                title="Underlines grammar and spelling mistakes in your writing, using this server's own checker"
              >
                Grammar check
              </MenuItem>
            )}
            <MenuItem onClick={copyPlainText} title="Copies this file's text with the LaTeX removed, ready to paste into another writing tool">
              {textCopied ? 'Copied' : 'Copy text without LaTeX'}
            </MenuItem>
            <MenuItem onClick={() => setVimMode((v) => !v)} active={vimMode}>
              Vim keybindings
            </MenuItem>
            <MenuItem onClick={() => setShowSymbols((v) => !v)} active={showSymbols}>
              Insert symbol
            </MenuItem>
            {pdfUrl && <MenuItem onClick={handleShowInPdf}>Show in PDF</MenuItem>}
            <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
            {!isViewer && (
              <MenuItem
                onClick={() => setSuggestMode((v) => !v)}
                active={suggestMode}
                title="Your edits become pending suggestions others can accept or reject"
              >
                Suggest mode
              </MenuItem>
            )}
            <MenuItem onClick={() => setShowSuggestions((v) => !v)} active={showSuggestions}>
              Suggestions{suggestions.length > 0 ? ` (${suggestions.length})` : ''}
            </MenuItem>
            <MenuItem
              onClick={handleCreateComment}
              disabled={!selectionNonEmpty}
              title={selectionNonEmpty ? 'Comment on the selected text' : 'Select some text to comment on it'}
            >
              Comment on selection
            </MenuItem>
            <MenuItem onClick={() => setShowComments((v) => !v)} active={showComments}>
              Comments{commentThreads.filter((t) => !t.resolved).length > 0 ? ` (${commentThreads.filter((t) => !t.resolved).length})` : ''}
            </MenuItem>
            <MenuItem onClick={() => setShowChat((v) => !v)} active={showChat}>
              Chat{unreadChat > 0 ? ` (${unreadChat})` : ''}
            </MenuItem>
            <MenuItem onClick={() => setShowAssistant((v) => !v)} active={showAssistant} title="Ask about your paper, fix LaTeX, draft passages">
              ✨ Assistant
            </MenuItem>
          </ToolbarMenu>
          {showSymbols && <SymbolPalette onInsert={handleInsertSnippet} onClose={() => setShowSymbols(false)} />}

          <button
            className="toolbar-button"
            onClick={cycleTheme}
            title={`Theme: ${THEME_LABEL[theme].name} — click to switch to ${THEME_LABEL[NEXT_THEME_NAME[theme]].name}`}
            aria-label={`Theme: ${THEME_LABEL[theme].name}`}
          >
            {THEME_LABEL[theme].icon}
          </button>

          <button className="toolbar-button" onClick={handleToggleHistory}>
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

          <button
            onClick={() => setShowLogPanel((v) => !v)}
            disabled={!compileResult}
            title={compileResult ? "Show this compile's log and errors" : 'Compile to see the log'}
            className="toolbar-button"
            style={{ background: showLogPanel ? 'var(--accent-bg)' : undefined, position: 'relative' }}
          >
            Logs
            {compileResult && problemCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  background: compileResult.success ? '#e0a030' : '#d64545',
                  color: 'white',
                  borderRadius: 8,
                  fontSize: 10,
                  padding: '1px 5px',
                  lineHeight: 1.4,
                }}
              >
                {problemCount}
              </span>
            )}
          </button>

          <button
            onClick={handleCompile}
            disabled={compiling}
            className={`compile-button${compiling ? ' compiling' : ''}`}
            title="Compile (Cmd/Ctrl+S or Cmd/Ctrl+Enter)"
          >
            {compiling ? 'Compiling' : 'Compile'}
          </button>
        </div>
        <div className={`compile-progress${compiling ? ' active' : ''}`} />
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <PanelGroup
          direction="horizontal"
          autoSaveId="quireloop-workspace"
          className={draggingSplit ? '' : 'panels-animate'}
          style={{ flex: 1, minWidth: 0, minHeight: 0 }}
        >
        <Panel
          ref={sidebarPanelRef}
          id="sidebar"
          order={1}
          defaultSize={17}
          minSize={11}
          maxSize={35}
          collapsible
          onCollapse={() => setSidebarOpen(false)}
          onExpand={() => setSidebarOpen(true)}
        >
        <div className="workspace-sidebar">
          <div className="segmented" style={{ '--count': SIDEBAR_TABS.length, '--index': SIDEBAR_TABS.findIndex(([id]) => id === sidebarTab) }}>
            <i />
            {SIDEBAR_TABS.map(([id, label]) => (
              <button key={id} className={sidebarTab === id ? 'active' : ''} onClick={() => setSidebarTab(id)}>
                {label}
              </button>
            ))}
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
                onDeleteMany={handleDeleteMany}
              />
            )}
            {sidebarTab === 'outline' && <OutlinePanel entries={outline} onJump={handleOutlineJump} />}
            {sidebarTab === 'git' && (
              <SourceControlPanel projectId={projectId} readOnly={isViewer} onPulled={handlePulled} />
            )}
            {sidebarTab === 'search' && <SearchPanel projectId={projectId} onJump={jumpToSource} />}
          </div>
        </div>
        </Panel>
        <PanelResizeHandle className="split-handle" onDragging={setDraggingSplit} />
        <Panel id="workspace" order={2} minSize={40}>
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
                    theme={theme}
                    user={user}
                    readOnly={isViewer}
                    spellcheck={spellcheck}
                    grammar={grammar && grammarAvailable}
                    vimMode={vimMode}
                    suggestMode={suggestMode && !isViewer}
                    onChange={handleEditorChange}
                    onStatus={setCollabStatus}
                    onRoomReset={() => api.getProject(projectId).then(setManifest)}
                    onJumpToPdf={jumpToPdfAtLine}
                    bibEntries={bibEntries}
                    onCollabHandles={setCollabHandles}
                    onSelectionChange={setSelectionNonEmpty}
                    onSuggestedChange={handleSuggestedChange}
                    onImageFiles={handleImageFiles}
                    getMacroSource={() => mainMacrosRef.current}
                  />
                )}
              </div>
              {showLogPanel && compileResult && (
                <CompileLogPanel
                  log={compileResult.log}
                  success={compileResult.success}
                  problems={compileResult.problems}
                  onClose={() => setShowLogPanel(false)}
                  onJump={jumpToSource}
                />
              )}
            </div>
          </Panel>
          <PanelResizeHandle className="split-handle" />
          <Panel defaultSize={45} minSize={15}>
            <PdfViewer ref={pdfViewerRef} url={pdfUrl} projectId={projectId} onJumpToSource={jumpToSource} />
          </Panel>
        </PanelGroup>
        </Panel>
        </PanelGroup>
        <SlidePanel open={showComments} width={300}>
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
        </SlidePanel>
        <SlidePanel open={showSuggestions} width={300}>
          <SuggestionsPanel
            suggestions={suggestionsWithText}
            canWrite={!isViewer}
            onAccept={handleAcceptSuggestion}
            onReject={handleRejectSuggestion}
            onClose={() => setShowSuggestions(false)}
          />
        </SlidePanel>
        <SlidePanel open={showChat} width={280}>
          <ChatPanel
            messages={chatMessages}
            currentUserId={user?.id}
            onSend={handleSendChat}
            onClose={() => setShowChat(false)}
          />
        </SlidePanel>
        <SlidePanel open={showAssistant} width={340}>
          <AssistantPanel
            projectId={projectId}
            activePath={activePath}
            editorRef={editorRef}
            readOnly={isViewer}
            onClose={() => setShowAssistant(false)}
          />
        </SlidePanel>
      </div>
      <CommandPalette open={showPalette} onClose={() => setShowPalette(false)} commands={commands} />
    </div>
  );
}
