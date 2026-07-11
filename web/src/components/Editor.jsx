import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting, foldGutter } from '@codemirror/language';
import { search, searchKeymap } from '@codemirror/search';
import { oneDark } from '@codemirror/theme-one-dark';
import { latex, latexCompletionSource, autocompletion, completionKeymap } from 'codemirror-lang-latex';

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

const Editor = forwardRef(function Editor(
  { filePath, content, initialLine, dark, onChange, onSave, onJumpToPdf, bibEntries },
  ref
) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onJumpToPdfRef = useRef(onJumpToPdf);
  const bibEntriesRef = useRef(bibEntries ?? []);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onJumpToPdfRef.current = onJumpToPdf;
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
    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        foldGutter(),
        EditorView.lineWrapping,
        history(),
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
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
        }),
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
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          {
            key: 'Mod-s',
            run: () => {
              onSaveRef.current?.();
              return true;
            },
          },
        ]),
        EditorView.theme({
          '&': { height: '100%', fontSize: '14px' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, monospace' },
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    if (initialLine) jumpToLine(view, initialLine);

    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, dark]);

  return <div ref={containerRef} style={{ height: '100%' }} />;
});

export default Editor;
