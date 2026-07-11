import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting, foldGutter } from '@codemirror/language';
import { search, searchKeymap } from '@codemirror/search';
import { oneDark } from '@codemirror/theme-one-dark';
import { latex, latexCompletionSource, autocompletion, completionKeymap } from 'codemirror-lang-latex';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';

// \cite{...} and its many variants (\citep, \citet, \parencite, \autocite,
// \footcite, biblatex's capitalized forms, ...) — matched generically by
// "contains cite" rather than an exhaustive list of command names.
const CITE_COMMAND_RE = /\\\w*[Cc]ite\w*\*?(\[[^\]]*\])*\{[^}]*/;

function citationCompletionSource(getBibEntries) {
  return (context) => {
    const before = context.matchBefore(CITE_COMMAND_RE);
    if (!before) return null;
    const entries = getBibEntries();
    if (entries.length === 0) return null;

    const braceIdx = before.text.lastIndexOf('{');
    const argsText = before.text.slice(braceIdx + 1);
    const lastComma = argsText.lastIndexOf(',');
    const from = before.from + braceIdx + 1 + (lastComma + 1);

    return {
      from,
      options: entries.map((e) => ({ label: e.key, detail: e.title, type: 'constant' })),
      validFor: /^[^,}]*$/,
    };
  };
}

function jumpToLine(view, line) {
  const doc = view.state.doc;
  const lineNum = Math.min(Math.max(line, 1), doc.lines);
  const pos = doc.line(lineNum).from;
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'center' }),
  });
  view.focus();
}

function insertAtCursor(view, text) {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
  view.focus();
}

// Deterministic per-user color for remote cursors/selections — same user
// always renders the same color across sessions and browser tabs.
function userColor(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return { color: `hsl(${hue}, 70%, 45%)`, colorLight: `hsl(${hue}, 70%, 45%, 0.25)` };
}

const Editor = forwardRef(function Editor(
  { projectId, filePath, collabGeneration, initialLine, dark, user, onChange, onJumpToPdf, onStatus, bibEntries },
  ref
) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const onJumpToPdfRef = useRef(onJumpToPdf);
  const onStatusRef = useRef(onStatus);
  const bibEntriesRef = useRef(bibEntries ?? []);
  onChangeRef.current = onChange;
  onJumpToPdfRef.current = onJumpToPdf;
  onStatusRef.current = onStatus;
  bibEntriesRef.current = bibEntries ?? [];

  useImperativeHandle(ref, () => ({
    goToLine: (line) => {
      if (viewRef.current) jumpToLine(viewRef.current, line);
    },
    insertAtCursor: (text) => {
      if (viewRef.current) insertAtCursor(viewRef.current, text);
    },
    getCursorLine: () => {
      if (!viewRef.current) return 1;
      const state = viewRef.current.state;
      return state.doc.lineAt(state.selection.main.head).number;
    },
  }));

  useEffect(() => {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('content');

    const indexeddb = new IndexeddbPersistence(
      `quireloop:${projectId}:${filePath}:${collabGeneration ?? 0}`,
      ydoc
    );

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const provider = new WebsocketProvider(`${wsProtocol}//${window.location.host}/ws/${projectId}`, filePath, ydoc);

    if (user) {
      const { color, colorLight } = userColor(user.id);
      provider.awareness.setLocalStateField('user', { name: user.email, color, colorLight });
    }

    provider.on('status', ({ status }) => onStatusRef.current?.(status));
    provider.on('sync', (synced) => onStatusRef.current?.(synced ? 'synced' : 'syncing'));

    const reportChange = () => onChangeRef.current?.(ytext.toString());
    ytext.observe(reportChange);

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        lineNumbers(),
        foldGutter(),
        EditorView.lineWrapping,
        yCollab(ytext, provider.awareness),
        // enableAutocomplete disabled here so we can fold in our own
        // \cite{} source alongside the built-in command/environment
        // completions — codemirror-lang-latex's own autocomplete uses
        // `override`, which replaces rather than merges completion
        // sources, so both need to live in one autocompletion() call.
        latex({ enableAutocomplete: false }),
        autocompletion({
          override: [latexCompletionSource(true), citationCompletionSource(() => bibEntriesRef.current)],
        }),
        keymap.of(completionKeymap),
        search(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        ...(dark ? [oneDark] : []),
        EditorView.domEventHandlers({
          dblclick(event, view) {
            // Leaves the browser's own double-click word-selection alone —
            // this just additionally jumps the PDF preview to the matching
            // spot, same idea as the hosted editor's double-click-to-locate.
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos == null) return;
            const line = view.state.doc.lineAt(pos).number;
            onJumpToPdfRef.current?.(line);
          },
        }),
        keymap.of([...yUndoManagerKeymap, ...defaultKeymap, ...searchKeymap]),
        EditorView.theme({
          '&': { height: '100%', fontSize: '14px' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, monospace' },
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    if (initialLine) jumpToLine(view, initialLine);

    return () => {
      ytext.unobserve(reportChange);
      view.destroy();
      provider.destroy();
      indexeddb.destroy();
      ydoc.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, filePath, collabGeneration, dark]);

  return <div ref={containerRef} style={{ height: '100%' }} />;
});

export default Editor;
