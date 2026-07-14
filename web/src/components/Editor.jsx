import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorView, keymap, lineNumbers, Decoration, gutter, GutterMarker, drawSelection } from '@codemirror/view';
import { EditorState, StateField, StateEffect, Compartment } from '@codemirror/state';
import { defaultKeymap } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting, foldGutter } from '@codemirror/language';
import { search, searchKeymap } from '@codemirror/search';
import { oneDark } from '@codemirror/theme-one-dark';
import { latex, latexCompletionSource, autocompletion, completionKeymap } from 'codemirror-lang-latex';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { vim, CodeMirror as VimCodeMirror } from '@replit/codemirror-vim';

// @replit/codemirror-vim's normal-mode 'u' / Ctrl-r drive its own internal
// CodeMirror.commands.undo/redo, which by default call @codemirror/commands'
// history — a StateField this editor never installs, since undo here goes
// through Yjs's UndoManager instead (see yCollab below), which is the only
// thing that stays correct under concurrent remote edits. y-codemirror.next
// doesn't export its `undo`/`redo` StateCommand functions directly, but they
// are the `run` handlers already wired into yUndoManagerKeymap (the keymap
// this editor uses for Mod-z/Mod-y outside vim mode) — pulling them out of
// there and patching Vim's internal commands routes vim's keys through the
// same Yjs-aware commands. This is a one-time patch of the imported
// module's shared class, not per-editor-instance state, so it's done once
// here at import time.
const yUndoCommand = yUndoManagerKeymap.find((k) => k.key === 'Mod-z').run;
const yRedoCommand = yUndoManagerKeymap.find((k) => k.key === 'Mod-y').run;
VimCodeMirror.commands.undo = (cm) => {
  yUndoCommand(cm.cm6);
};
VimCodeMirror.commands.redo = (cm) => {
  yRedoCommand(cm.cm6);
};

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

// Comment range highlighting — a StateField so ranges survive concurrent
// document edits via CodeMirror's own change-mapping (`Decoration.map`),
// same idea as the Yjs relative positions used to compute them in the
// first place. ProjectView recomputes absolute ranges from the threads'
// relative positions and pushes them in via setCommentRangesEffect.
const setCommentRangesEffect = StateEffect.define();

const commentHighlightField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setCommentRangesEffect)) {
        const marks = effect.value
          .filter((r) => r.from < r.to && r.to <= tr.state.doc.length)
          .sort((a, b) => a.from - b.from || a.to - b.to)
          .map((r) =>
            Decoration.mark({ class: r.resolved ? 'cm-comment-range-resolved' : 'cm-comment-range' }).range(
              r.from,
              r.to
            )
          );
        decorations = Decoration.set(marks, true);
      }
    }
    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// Compile diagnostics — CodeMirror's @codemirror/lint package isn't an
// installed dependency here, so this is a small hand-rolled equivalent:
// a StateField holding the raw {line, severity, message} list (pushed in
// via ProjectView after each compile, mapped down to the current file),
// a derived Decoration field for the wavy underline, and a gutter that
// marks the same lines. Line numbers from the compile log can drift past
// the current doc (edits since the last compile) — clamped everywhere,
// and any further edit just clears the diagnostics outright rather than
// trying to remap stale positions.
const setDiagnosticsEffect = StateEffect.define();

const diagnosticsField = StateField.define({
  create() {
    return [];
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setDiagnosticsEffect)) return effect.value;
    }
    if (tr.docChanged) return [];
    return value;
  },
});

function diagnosticsForLine(state, lineNumber) {
  const diagnostics = state.field(diagnosticsField, false) ?? [];
  const total = state.doc.lines;
  return diagnostics.filter((d) => Math.min(Math.max(d.line, 1), total) === lineNumber);
}

function computeDiagnosticDecorations(state) {
  const diagnostics = state.field(diagnosticsField, false) ?? [];
  const doc = state.doc;
  const marks = diagnostics
    .map((d) => {
      const lineNum = Math.min(Math.max(d.line, 1), doc.lines);
      const line = doc.line(lineNum);
      if (line.to <= line.from) return null;
      return Decoration.mark({
        class: d.severity === 'error' ? 'cm-diagnostic-error' : 'cm-diagnostic-warning',
        attributes: { title: d.message },
      }).range(line.from, line.to);
    })
    .filter(Boolean)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(marks, true);
}

const diagnosticDecorationField = StateField.define({
  create(state) {
    return computeDiagnosticDecorations(state);
  },
  update(decorations, tr) {
    const touched = tr.effects.some((e) => e.is(setDiagnosticsEffect));
    if (touched) return computeDiagnosticDecorations(tr.state);
    if (tr.docChanged) return Decoration.none;
    return decorations.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

class DiagnosticGutterMarker extends GutterMarker {
  constructor(severity, message) {
    super();
    this.severity = severity;
    this.message = message;
  }

  toDOM() {
    const span = document.createElement('span');
    span.textContent = this.severity === 'error' ? '●' : '▲';
    span.title = this.message;
    span.style.color = this.severity === 'error' ? '#d64545' : '#e0a030';
    span.style.fontSize = '10px';
    span.style.cursor = 'default';
    return span;
  }
}

const diagnosticGutter = gutter({
  class: 'cm-diagnostic-gutter',
  lineMarker(view, line) {
    const lineNumber = view.state.doc.lineAt(line.from).number;
    const matches = diagnosticsForLine(view.state, lineNumber);
    if (matches.length === 0) return null;
    const severity = matches.some((d) => d.severity === 'error') ? 'error' : 'warning';
    const message = matches.map((d) => d.message).join('; ');
    return new DiagnosticGutterMarker(severity, message);
  },
  lineMarkerChange(update) {
    return update.docChanged || update.transactions.some((tr) => tr.effects.some((e) => e.is(setDiagnosticsEffect)));
  },
});

// Browser-native spell check — CodeMirror's content DOM is contenteditable,
// so the browser's own spell checker (dictionary = the user's OS/browser
// language, not a bundled word list) already works if the contenteditable
// attributes ask for it. Off by default: it happily underlines LaTeX
// commands and math as "misspelled" too, which is noisy enough that it
// needs to be an opt-in toggle rather than always-on.
function spellcheckAttrs(enabled) {
  return enabled
    ? { spellcheck: 'true', autocorrect: 'off', autocapitalize: 'off' }
    : { spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' };
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
  {
    projectId,
    filePath,
    collabGeneration,
    initialLine,
    dark,
    user,
    readOnly,
    spellcheck,
    vimMode,
    onChange,
    onJumpToPdf,
    onStatus,
    bibEntries,
    onCollabHandles,
    onSelectionChange,
  },
  ref
) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const spellcheckCompartmentRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const onJumpToPdfRef = useRef(onJumpToPdf);
  const onStatusRef = useRef(onStatus);
  const bibEntriesRef = useRef(bibEntries ?? []);
  const onCollabHandlesRef = useRef(onCollabHandles);
  const onSelectionChangeRef = useRef(onSelectionChange);
  onChangeRef.current = onChange;
  onJumpToPdfRef.current = onJumpToPdf;
  onStatusRef.current = onStatus;
  bibEntriesRef.current = bibEntries ?? [];
  onCollabHandlesRef.current = onCollabHandles;
  onSelectionChangeRef.current = onSelectionChange;

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
    selectRange: (from, to) => {
      const view = viewRef.current;
      if (!view) return;
      const clampedFrom = Math.max(0, Math.min(from, view.state.doc.length));
      const clampedTo = Math.max(0, Math.min(to, view.state.doc.length));
      view.dispatch({
        selection: { anchor: clampedFrom, head: clampedTo },
        effects: EditorView.scrollIntoView(clampedFrom, { y: 'center' }),
      });
      view.focus();
    },
    setCommentRanges: (ranges) => {
      if (viewRef.current) {
        viewRef.current.dispatch({ effects: setCommentRangesEffect.of(ranges) });
      }
    },
    setDiagnostics: (list) => {
      if (viewRef.current) {
        viewRef.current.dispatch({ effects: setDiagnosticsEffect.of(list ?? []) });
      }
    },
    // Reconfigures spellcheck in place via a Compartment rather than
    // remounting the whole editor (unlike vimMode, which does remount) —
    // toggling it shouldn't tear down and resync the Yjs doc/provider.
    setSpellcheck: (enabled) => {
      const view = viewRef.current;
      const compartment = spellcheckCompartmentRef.current;
      if (view && compartment) {
        view.dispatch({
          effects: compartment.reconfigure(EditorView.contentAttributes.of(spellcheckAttrs(enabled))),
        });
      }
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

    spellcheckCompartmentRef.current = new Compartment();

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        // vim() must come first in the extensions array so it can intercept
        // keys before other keymaps see them (per the package's own README).
        // drawSelection() is also needed alongside it — without it, visual
        // mode's block/line selections render with the browser's native
        // (non-block-aware) selection instead of vim's expected highlight.
        ...(vimMode ? [vim(), drawSelection()] : []),
        lineNumbers(),
        foldGutter(),
        EditorView.lineWrapping,
        yCollab(ytext, provider.awareness),
        spellcheckCompartmentRef.current.of(EditorView.contentAttributes.of(spellcheckAttrs(spellcheck))),
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
        commentHighlightField,
        diagnosticsField,
        diagnosticDecorationField,
        diagnosticGutter,
        EditorView.updateListener.of((update) => {
          if (update.selectionSet) {
            const { from, to } = update.state.selection.main;
            onSelectionChangeRef.current?.(from !== to);
          }
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '14px' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, monospace' },
          '.cm-comment-range': { backgroundColor: 'rgba(255, 205, 60, 0.35)' },
          '.cm-comment-range-resolved': { backgroundColor: 'rgba(150, 150, 150, 0.2)' },
          '.cm-diagnostic-error': {
            textDecoration: 'underline wavy #d64545',
            textDecorationSkipInk: 'none',
          },
          '.cm-diagnostic-warning': {
            textDecoration: 'underline wavy #e0a030',
            textDecorationSkipInk: 'none',
          },
          '.cm-diagnostic-gutter': { width: '14px' },
        }),
        // Belt-and-suspenders with the websocket-layer drop of viewer
        // updates: this keeps a viewer from even trying to type locally.
        ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    if (initialLine) jumpToLine(view, initialLine);

    onCollabHandlesRef.current?.({ ydoc, ytext, view });

    return () => {
      onCollabHandlesRef.current?.(null);
      ytext.unobserve(reportChange);
      view.destroy();
      provider.destroy();
      indexeddb.destroy();
      ydoc.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, filePath, collabGeneration, dark, readOnly, vimMode]);

  return <div ref={containerRef} style={{ height: '100%' }} />;
});

export default Editor;
