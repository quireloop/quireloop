import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { api } from '../api.js';
import { normalizePdfWord } from '../lib/editorExtras.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const DARK_PDF_STORAGE_KEY = 'quireloop:pdfDark';

function readStoredFlag(key) {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

// Rectangles (relative to `wrapper`) covering characters [start, end) of a
// pdf.js text-layer span. The span is scaled with a CSS transform, which
// getClientRects() already accounts for — so these line up with the canvas.
function rangeRects(span, start, end, wrapper) {
  const node = span.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) return [];
  const range = document.createRange();
  range.setStart(node, Math.max(0, Math.min(start, node.length)));
  range.setEnd(node, Math.max(0, Math.min(end, node.length)));
  const base = wrapper.getBoundingClientRect();
  return [...range.getClientRects()].map((r) => ({
    left: r.left - base.left,
    top: r.top - base.top,
    width: r.width,
    height: r.height,
  }));
}

function addRect(layer, rect, className) {
  const el = document.createElement('div');
  el.className = className;
  Object.assign(el.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  layer.appendChild(el);
  return el;
}

const PdfViewer = forwardRef(function PdfViewer({ url, projectId, onJumpToSource }, ref) {
  const containerRef = useRef(null);
  // [{ wrapper, canvas, overlay, searchLayer, pageNum, scale, textDivs, items }]
  const pagesRef = useRef([]);
  const docRef = useRef(null);
  const renderTokenRef = useRef(0);
  const syncFadeTimerRef = useRef(null);
  const searchInputRef = useRef(null);
  const searchStateRef = useRef({ query: '', matches: [], index: -1 });
  const [error, setError] = useState('');
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.3);
  const [pageInput, setPageInput] = useState('');
  const [darkPdf, setDarkPdf] = useState(() => readStoredFlag(DARK_PDF_STORAGE_KEY));
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInfo, setSearchInfo] = useState({ count: 0, index: -1 });

  useImperativeHandle(ref, () => ({
    showSyncResult,
    // Kept for callers that only have a single point.
    scrollToPosition: (page, x, y) => showSyncResult({ page, x, y, boxes: [] }),
  }));

  useEffect(() => {
    try {
      localStorage.setItem(DARK_PDF_STORAGE_KEY, String(darkPdf));
    } catch {
      // storage unavailable (private mode) — the toggle still works this session
    }
  }, [darkPdf]);

  // ---------------------------------------------------------------------
  // Forward sync: outline every box the source line produced, and the
  // double-clicked word inside them when it can be found, then fade out —
  // the same cue the hosted editor gives.
  function showSyncResult(result, word) {
    const entry = pagesRef.current.find((p) => p.pageNum === result.page);
    if (!entry) return;
    for (const p of pagesRef.current) p.overlay.replaceChildren();
    clearTimeout(syncFadeTimerRef.current);

    const boxes = (result.boxes ?? []).filter((b) => b.W > 0 && b.H > 0);
    let scrollTop = null;
    for (const box of boxes) {
      const page = pagesRef.current.find((p) => p.pageNum === box.page);
      if (!page) continue;
      const pad = 2;
      const rect = {
        left: box.h * page.scale - pad,
        top: (box.v - box.H) * page.scale - pad,
        width: box.W * page.scale + 2 * pad,
        height: box.H * page.scale + 2 * pad,
      };
      addRect(page.overlay, rect, 'pdf-sync-box');
      if (box.page === result.page && scrollTop === null) scrollTop = page.wrapper.offsetTop + rect.top;
      if (word) highlightWordInBox(page, box, word);
    }
    if (boxes.length === 0) {
      // No extent to outline — fall back to a dot at the reported point.
      const dot = { left: result.x * entry.scale - 6, top: result.y * entry.scale - 6, width: 12, height: 12 };
      addRect(entry.overlay, dot, 'pdf-sync-dot');
      scrollTop = entry.wrapper.offsetTop + dot.top;
    }

    const container = containerRef.current;
    container.scrollTo({ top: Math.max(0, scrollTop - container.clientHeight / 3), behavior: 'smooth' });
    syncFadeTimerRef.current = setTimeout(() => {
      for (const p of pagesRef.current) {
        for (const el of p.overlay.children) el.classList.add('fading');
      }
    }, 1800);
  }

  function highlightWordInBox(page, box, word) {
    const needle = normalizePdfWord(word).toLowerCase();
    if (needle.length < 2) return;
    const s = page.scale;
    const boxRect = { left: box.h * s, right: (box.h + box.W) * s, top: (box.v - box.H) * s - 4, bottom: box.v * s + 4 };
    const base = page.wrapper.getBoundingClientRect();
    for (const span of page.textDivs) {
      const r = span.getBoundingClientRect();
      const left = r.left - base.left;
      const top = r.top - base.top;
      if (left > boxRect.right || left + r.width < boxRect.left || top > boxRect.bottom || top + r.height < boxRect.top) {
        continue;
      }
      const idx = (span.textContent ?? '').toLowerCase().indexOf(needle);
      if (idx === -1) continue;
      for (const rect of rangeRects(span, idx, idx + needle.length, page.wrapper)) {
        addRect(page.overlay, rect, 'pdf-sync-word');
      }
      return;
    }
  }

  // ---------------------------------------------------------------------
  // Reverse sync: double-click on the PDF (single clicks are for selecting
  // text now that there's a text layer). The browser has already selected
  // the word under the pointer by the time dblclick fires; pass it on so
  // the editor can land on that word instead of the start of the line.
  async function handleDoubleClick(e, pageNum, pageScale, wrapper) {
    if (!onJumpToSource || !projectId) return;
    const rect = wrapper.getBoundingClientRect();
    const x = (e.clientX - rect.left) / pageScale;
    const y = (e.clientY - rect.top) / pageScale;
    const selected = window.getSelection()?.toString().trim() ?? '';
    const word = selected.length > 0 && selected.length < 60 && !/\s/.test(selected) ? selected : '';
    try {
      const result = await api.synctexToSource(projectId, pageNum, x, y);
      onJumpToSource(result.file, result.line, { word });
    } catch {
      // no match at that position (margins, or text from a package file) — ignore
    }
  }

  // ---------------------------------------------------------------------
  // Find in PDF. Matches are searched per page over the text layer's items,
  // joined the way they read (an end-of-line item gets a space), then mapped
  // back onto the spans to draw highlight rectangles.
  function clearSearchHighlights() {
    for (const p of pagesRef.current) p.searchLayer.replaceChildren();
  }

  function runSearch(query, { keepIndex = false } = {}) {
    clearSearchHighlights();
    const state = searchStateRef.current;
    const previousIndex = state.index;
    state.query = query;
    state.matches = [];
    state.index = -1;
    const needle = query.trim().toLowerCase();
    if (!needle) {
      setSearchInfo({ count: 0, index: -1 });
      return;
    }
    for (const page of pagesRef.current) {
      let full = '';
      const spans = []; // [{ start, end, div }]
      page.items.forEach((item, i) => {
        const start = full.length;
        full += item.str;
        spans.push({ start, end: full.length, div: page.textDivs[i] });
        if (item.hasEOL) full += ' ';
      });
      const hay = full.toLowerCase();
      let at = hay.indexOf(needle);
      while (at !== -1) {
        const end = at + needle.length;
        const els = [];
        for (const s of spans) {
          if (!s.div || s.end <= at || s.start >= end) continue;
          for (const rect of rangeRects(s.div, Math.max(at, s.start) - s.start, Math.min(end, s.end) - s.start, page.wrapper)) {
            els.push(addRect(page.searchLayer, rect, 'pdf-search-hit'));
          }
        }
        if (els.length > 0) state.matches.push({ page, els });
        at = hay.indexOf(needle, end);
      }
    }
    if (state.matches.length > 0) {
      const start = keepIndex && previousIndex >= 0 ? Math.min(previousIndex, state.matches.length - 1) : 0;
      selectMatch(start, { scroll: !keepIndex });
    } else {
      setSearchInfo({ count: 0, index: -1 });
    }
  }

  function selectMatch(index, { scroll = true } = {}) {
    const state = searchStateRef.current;
    if (state.matches.length === 0) return;
    const n = state.matches.length;
    state.index = ((index % n) + n) % n;
    state.matches.forEach((m, i) => m.els.forEach((el) => el.classList.toggle('current', i === state.index)));
    setSearchInfo({ count: n, index: state.index });
    if (!scroll) return;
    const { page, els } = state.matches[state.index];
    const top = page.wrapper.offsetTop + parseFloat(els[0].style.top);
    const container = containerRef.current;
    container.scrollTo({ top: Math.max(0, top - container.clientHeight / 3), behavior: 'smooth' });
  }

  function handleSearchKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (searchStateRef.current.query !== searchQuery) runSearch(searchQuery);
      else selectMatch(searchStateRef.current.index + (e.shiftKey ? -1 : 1));
    } else if (e.key === 'Escape') {
      setSearchQuery('');
      runSearch('');
      containerRef.current?.focus();
    }
  }

  // Ctrl/Cmd+F while the PDF pane has focus searches the PDF instead of
  // opening the browser's find bar (which can't see canvas-rendered text).
  function handlePaneKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  }

  // ---------------------------------------------------------------------

  async function renderPages(doc, useScale) {
    // Guards against overlapping renders (React StrictMode double-invokes
    // effects in dev, and zoom clicks can fire before a prior render
    // finishes) — a stale render must not touch the DOM once superseded.
    const token = ++renderTokenRef.current;
    const container = containerRef.current;
    // Recompiles produce a brand-new PDF URL every time (cache-busting), so
    // this effect re-fires on every compile even when the reader hasn't
    // moved — capture how far down they'd scrolled as a ratio (not an
    // absolute pixel offset, since page count/height can shift slightly)
    // so we can put them back roughly where they were instead of snapping
    // to page 1 on every single compile.
    //
    // The first render shows pages as they arrive. After that the new pages
    // are built off screen and swapped in together, so a recompile or zoom
    // never blanks the PDF the reader is looking at.
    const firstRender = container.childElementCount === 0;
    const nextPages = [];
    if (firstRender) pagesRef.current = nextPages;

    // The canvas backing store must be rendered at device-pixel resolution,
    // not CSS-pixel resolution, or the browser upscales it on HiDPI/Retina
    // displays and every page looks soft/blurred regardless of zoom level.
    const outputScale = window.devicePixelRatio || 1;

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      if (renderTokenRef.current !== token) return;
      const viewport = page.getViewport({ scale: useScale });

      // One positioned box per page: the canvas, pdf.js's transparent text
      // layer over it (selection, copy, find), and two overlays on top for
      // search hits and SyncTeX highlights, neither of which takes clicks.
      const wrapper = document.createElement('div');
      wrapper.className = 'pdf-page';
      wrapper.style.width = `${viewport.width}px`;
      wrapper.style.height = `${viewport.height}px`;
      wrapper.style.setProperty('--scale-factor', String(useScale));
      wrapper.dataset.page = pageNum;

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const textLayerDiv = document.createElement('div');
      textLayerDiv.className = 'textLayer';
      const searchLayer = document.createElement('div');
      searchLayer.className = 'pdf-overlay';
      const overlay = document.createElement('div');
      overlay.className = 'pdf-overlay';

      wrapper.append(canvas, textLayerDiv, searchLayer, overlay);
      wrapper.addEventListener('dblclick', (e) => handleDoubleClick(e, pageNum, useScale, wrapper));
      if (firstRender) {
        wrapper.classList.add('pdf-page-enter');
        container.appendChild(wrapper);
      }

      const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport, transform }).promise;
      if (renderTokenRef.current !== token) return;

      const textContent = await page.getTextContent();
      if (renderTokenRef.current !== token) return;
      const textLayer = new pdfjsLib.TextLayer({ textContentSource: textContent, container: textLayerDiv, viewport });
      await textLayer.render();
      if (renderTokenRef.current !== token) return;

      nextPages.push({
        wrapper,
        canvas,
        overlay,
        searchLayer,
        pageNum,
        scale: useScale,
        textDivs: textLayer.textDivs,
        // Only items that produced a span line up with textDivs one-to-one.
        items: textContent.items.filter((item) => 'str' in item),
      });
    }

    const scrollableHeight = container.scrollHeight - container.clientHeight;
    const scrollRatio = scrollableHeight > 0 ? container.scrollTop / scrollableHeight : 0;
    if (!firstRender) {
      container.replaceChildren(...nextPages.map((p) => p.wrapper));
      pagesRef.current = nextPages;
    }
    const newScrollableHeight = container.scrollHeight - container.clientHeight;
    if (newScrollableHeight > 0) {
      container.scrollTop = scrollRatio * newScrollableHeight;
    }
    // A recompile or zoom re-renders everything; keep an active search alive.
    if (searchStateRef.current.query) runSearch(searchStateRef.current.query, { keepIndex: true });
  }

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setError('');

    (async () => {
      try {
        const doc = await pdfjsLib.getDocument(url).promise;
        if (cancelled) return;
        docRef.current = doc;
        setPageCount(doc.numPages);
        await renderPages(doc, scale);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  async function applyScale(newScale) {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
    setScale(clamped);
    // Stretch the pages at once so zooming follows the click; the sharp render
    // replaces them when it's ready.
    for (const p of pagesRef.current) p.wrapper.style.zoom = String(clamped / p.scale);
    if (docRef.current) await renderPages(docRef.current, clamped);
  }

  async function handleFitWidth() {
    if (!docRef.current || !containerRef.current) return;
    const page = await docRef.current.getPage(1);
    const naturalWidth = page.getViewport({ scale: 1 }).width;
    const available = containerRef.current.clientWidth - 24;
    await applyScale(available / naturalWidth);
  }

  function handlePageJump(e) {
    e.preventDefault();
    const num = Number(pageInput);
    const entry = pagesRef.current.find((p) => p.pageNum === num);
    if (entry) entry.wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (!url) {
    return (
      <div className="empty-state">
        <strong>No preview yet</strong>
        <span>Press Compile to see your paper here.</span>
      </div>
    );
  }

  const smallButton = { padding: '3px 8px' };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }} onKeyDown={handlePaneKeyDown}>
      <div className="pdf-toolbar">
        <button onClick={() => applyScale(scale - 0.2)} style={smallButton} title="Zoom out">
          −
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button onClick={() => applyScale(scale + 0.2)} style={smallButton} title="Zoom in">
          +
        </button>
        <button onClick={handleFitWidth} style={smallButton}>
          Fit width
        </button>
        <form onSubmit={handlePageJump} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            placeholder="Page"
            title="Type a page number and press Enter"
            style={{ width: 48, padding: '2px 6px' }}
          />
        </form>
        <span style={{ color: 'var(--text-muted)' }}>of {pageCount}</span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKey}
            placeholder="Find in PDF"
            title="Enter: next match · Shift+Enter: previous · Esc: clear (Ctrl/Cmd+F from the PDF)"
            style={{ width: 88, padding: '2px 6px' }}
          />
          <button style={smallButton} title="Previous match" onClick={() => selectMatch(searchStateRef.current.index - 1)}>
            ↑
          </button>
          <button
            style={smallButton}
            title="Next match"
            onClick={() =>
              searchStateRef.current.query !== searchQuery
                ? runSearch(searchQuery)
                : selectMatch(searchStateRef.current.index + 1)
            }
          >
            ↓
          </button>
          {searchStateRef.current.query && (
            <span style={{ color: 'var(--text-muted)', minWidth: 44 }}>
              {searchInfo.count === 0 ? 'no match' : `${searchInfo.index + 1}/${searchInfo.count}`}
            </span>
          )}
        </div>
        <button
          onClick={() => setDarkPdf((v) => !v)}
          style={smallButton}
          title="Show the PDF with dark pages (display only — the PDF file is unchanged)"
          aria-pressed={darkPdf}
        >
          {darkPdf ? '☀' : '◐'}
        </button>
        <a href={url} download className="link-button" style={{ marginLeft: 'auto' }}>
          Download
        </a>
      </div>
      {error && <p style={{ color: 'crimson', padding: '0 12px' }}>Failed to load PDF: {error}</p>}
      <div
        ref={containerRef}
        tabIndex={0}
        className={darkPdf ? 'pdf-pages pdf-dark' : 'pdf-pages'}
        style={{ position: 'relative', flex: 1, overflow: 'auto', padding: 12, background: 'var(--pdf-bg)', outline: 'none' }}
      />
    </div>
  );
});

export default PdfViewer;
