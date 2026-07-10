import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { api } from '../api.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

const PdfViewer = forwardRef(function PdfViewer({ url, projectId, onJumpToSource }, ref) {
  const containerRef = useRef(null);
  const pagesRef = useRef([]); // [{ canvas, pageNum, scale, heightPts }]
  const docRef = useRef(null);
  const renderTokenRef = useRef(0);
  const [error, setError] = useState('');
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.3);
  const [pageInput, setPageInput] = useState('');

  useImperativeHandle(ref, () => ({
    scrollToPosition: (page, x, y) => {
      const entry = pagesRef.current.find((p) => p.pageNum === page);
      if (!entry) return;
      const targetY = entry.canvas.offsetTop + y * entry.scale - 100;
      containerRef.current.scrollTo({ top: targetY, behavior: 'smooth' });
      flashMarker(entry.canvas, x * entry.scale, y * entry.scale);
    },
  }));

  function flashMarker(canvas, x, y) {
    const marker = document.createElement('div');
    marker.style.position = 'absolute';
    marker.style.left = `${canvas.offsetLeft + x - 6}px`;
    marker.style.top = `${canvas.offsetTop + y - 6}px`;
    marker.style.width = '12px';
    marker.style.height = '12px';
    marker.style.borderRadius = '50%';
    marker.style.background = 'rgba(255,80,0,0.7)';
    marker.style.pointerEvents = 'none';
    marker.style.transition = 'opacity 1s';
    containerRef.current.appendChild(marker);
    requestAnimationFrame(() => {
      setTimeout(() => {
        marker.style.opacity = '0';
        setTimeout(() => marker.remove(), 1000);
      }, 600);
    });
  }

  async function handleCanvasClick(e, pageNum, pageScale) {
    if (!onJumpToSource || !projectId) return;
    const canvas = e.target;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const x = clickX / pageScale;
    const y = clickY / pageScale;
    try {
      const result = await api.synctexToSource(projectId, pageNum, x, y);
      onJumpToSource(result.file, result.line);
    } catch {
      // no match at that position — ignore
    }
  }

  async function renderPages(doc, useScale) {
    // Guards against overlapping renders (React StrictMode double-invokes
    // effects in dev, and zoom clicks can fire before a prior render
    // finishes) — a stale render must not touch the DOM once superseded.
    const token = ++renderTokenRef.current;
    const container = containerRef.current;
    container.innerHTML = '';
    pagesRef.current = [];

    // The canvas backing store must be rendered at device-pixel resolution,
    // not CSS-pixel resolution, or the browser upscales it on HiDPI/Retina
    // displays and every page looks soft/blurred regardless of zoom level.
    const outputScale = window.devicePixelRatio || 1;

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      if (renderTokenRef.current !== token) return;
      const viewport = page.getViewport({ scale: useScale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.style.display = 'block';
      canvas.style.marginBottom = '12px';
      canvas.style.boxShadow = '0 1px 4px rgba(0,0,0,0.2)';
      canvas.style.cursor = onJumpToSource ? 'text' : 'default';
      canvas.dataset.page = pageNum;
      canvas.addEventListener('click', (e) => handleCanvasClick(e, pageNum, useScale));
      container.appendChild(canvas);
      const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport, transform }).promise;
      if (renderTokenRef.current !== token) return;
      pagesRef.current.push({ canvas, pageNum, scale: useScale, heightPts: viewport.height / useScale });
    }
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
    if (entry) entry.canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (!url) {
    return <div style={{ padding: 16, color: 'var(--text-muted)' }}>Compile to see the PDF preview.</div>;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 8px',
          borderBottom: '1px solid var(--border)',
          fontSize: 12,
        }}
      >
        <button onClick={() => applyScale(scale - 0.2)} style={{ padding: '2px 8px' }}>
          −
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button onClick={() => applyScale(scale + 0.2)} style={{ padding: '2px 8px' }}>
          +
        </button>
        <button onClick={handleFitWidth} style={{ padding: '2px 8px' }}>
          Fit width
        </button>
        <form onSubmit={handlePageJump} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            placeholder="Page"
            style={{ width: 48, padding: 2 }}
          />
          <button type="submit" style={{ padding: '2px 8px' }}>
            Go
          </button>
        </form>
        <span style={{ color: 'var(--text-muted)' }}>{pageCount} page(s)</span>
        <a href={url} download style={{ marginLeft: 'auto' }}>
          Download PDF
        </a>
      </div>
      {error && <p style={{ color: 'crimson', padding: '0 12px' }}>Failed to load PDF: {error}</p>}
      <div ref={containerRef} style={{ position: 'relative', flex: 1, overflow: 'auto', padding: 12, background: 'var(--pdf-bg)' }} />
    </div>
  );
});

export default PdfViewer;
