import { useEffect, useRef, useState } from 'react';
import { BASE_PATH } from '../basePath.js';
import { assistantApi } from '../api.js';

const MODEL_STORAGE_KEY = 'quireloop:assistant-model';

// Subscriptions can't be plugged in, but the person's own browser is already
// signed in to them: the question goes there on the clipboard.
const SUBSCRIPTION_SITES = [
  { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { name: 'Claude', url: 'https://claude.ai/new' },
  { name: 'Gemini', url: 'https://gemini.google.com/app' },
];

// Splits assistant markdown into text and fenced-code segments so code
// blocks get their own styling and an insert-at-cursor button. Not a full
// markdown renderer on purpose — plain text + code covers what a LaTeX
// writing assistant actually produces, without a new dependency.
function splitSegments(text) {
  const segments = [];
  const fence = /```([a-zA-Z]*)\n([\s\S]*?)(?:```|$)/g;
  let last = 0;
  let m;
  while ((m = fence.exec(text)) !== null) {
    if (m.index > last) segments.push({ type: 'text', text: text.slice(last, m.index) });
    segments.push({ type: 'code', lang: m[1], text: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ type: 'text', text: text.slice(last) });
  return segments;
}

function CodeBlock({ segment, onInsert, readOnly }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, margin: '4px 0', overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '2px 6px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--panel-bg)',
        }}
      >
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{segment.lang || 'code'}</span>
        <span style={{ display: 'flex', gap: 4 }}>
          <button
            style={{ fontSize: 10, padding: '1px 6px' }}
            onClick={() => {
              navigator.clipboard.writeText(segment.text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          {!readOnly && (
            <button style={{ fontSize: 10, padding: '1px 6px' }} onClick={() => onInsert(segment.text)}>
              Insert
            </button>
          )}
        </span>
      </div>
      <pre
        style={{
          margin: 0,
          padding: 6,
          fontSize: 11,
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {segment.text}
      </pre>
    </div>
  );
}

function readSavedModel() {
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY);
  } catch {
    return null;
  }
}

export default function AssistantPanel({ projectId, activePath, editorRef, readOnly, onClose }) {
  // [{role: 'user'|'assistant', content}] — kept per panel session, not persisted.
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [catalog, setCatalog] = useState({ provider: null, models: [] });
  const [model, setModel] = useState('');
  const [handedOff, setHandedOff] = useState('');
  const scrollRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    assistantApi
      .models()
      .then((next) => {
        setCatalog(next);
        const saved = readSavedModel();
        setModel(next.models.includes(saved) ? saved : next.model || '');
      })
      .catch(() => {});
  }, []);

  function chooseModel(next) {
    setModel(next);
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, next);
    } catch {
      // only a convenience; the choice still applies until the panel closes
    }
  }

  async function askElsewhere(site) {
    const selection = editorRef.current?.getSelectedText?.() ?? '';
    const passage = selection || editorRef.current?.getText?.() || '';
    const prompt = [input.trim(), passage && `Here is the LaTeX:\n\n${passage}`].filter(Boolean).join('\n\n');
    try {
      await navigator.clipboard.writeText(prompt);
      setHandedOff(`Copied. Paste it into ${site.name} with Ctrl+V.`);
    } catch {
      setHandedOff('Your browser blocked copying. Copy the text by hand.');
    }
    window.open(site.url, '_blank', 'noopener,noreferrer');
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function send(e) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setError('');
    const selection = editorRef.current?.getSelectedText?.() ?? '';
    const history = [...messages, { role: 'user', content: text }];
    // Add an empty assistant message that the stream fills in.
    setMessages([...history, { role: 'assistant', content: '' }]);
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`${BASE_PATH}/api/projects/${projectId}/assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, file: activePath, selection, ...(model ? { model } : {}) }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantText = '';
      const appendDelta = (delta) => {
        assistantText += delta;
        setMessages((list) => {
          const next = list.slice();
          next[next.length - 1] = { role: 'assistant', content: assistantText };
          return next;
        });
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line.
        const frames = buffer.split('\n\n');
        buffer = frames.pop();
        for (const frame of frames) {
          const eventMatch = frame.match(/^event: (.+)$/m);
          const dataMatch = frame.match(/^data: (.+)$/m);
          if (!eventMatch || !dataMatch) continue;
          const data = JSON.parse(dataMatch[1]);
          if (eventMatch[1] === 'text') appendDelta(data.text);
          else if (eventMatch[1] === 'error') throw new Error(data.message);
        }
      }
      if (!assistantText) {
        // Stream ended without content (refusal or upstream hiccup).
        setMessages(history);
        setError('The assistant returned no answer — try rephrasing.');
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message);
        // Drop the empty assistant bubble but keep the user's question.
        setMessages((list) => (list[list.length - 1]?.content === '' ? list.slice(0, -1) : list));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function insert(text) {
    editorRef.current?.insertAtCursor?.(text.replace(/\n$/, ''));
  }

  return (
    <div
      style={{
        width: 340,
        borderLeft: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--panel-bg)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 8,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <strong style={{ fontSize: 13 }}>✨ Assistant</strong>
        <span style={{ display: 'flex', gap: 4 }}>
          {messages.length > 0 && (
            <button onClick={() => setMessages([])} style={{ fontSize: 12 }} title="Clear the conversation">
              Clear
            </button>
          )}
          <button onClick={onClose} style={{ fontSize: 12 }}>
            Close
          </button>
        </span>
      </div>
      {catalog.provider && (
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 8px', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
          Model
          <select
            value={model}
            disabled={busy || catalog.models.length === 0}
            onChange={(e) => chooseModel(e.target.value)}
            style={{ flex: 1, minWidth: 0, fontSize: 12 }}
          >
            {catalog.models.length === 0 && <option value="">No models found</option>}
            {catalog.models.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.length === 0 && !catalog.provider && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            No assistant is set up in Quireloop yet. You can add one in Account settings, or use the buttons below with
            a subscription you already have.
          </p>
        )}
        {messages.length === 0 && catalog.provider && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Ask about your paper — rewrite a paragraph, fix a LaTeX error, draft a table, tighten an abstract. The
            assistant sees the file you have open{readOnly ? '' : ', and code blocks insert at your cursor'}. Select
            text first to ask about a specific passage.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'stretch',
              maxWidth: m.role === 'user' ? '85%' : '100%',
              background: m.role === 'user' ? 'var(--accent-bg)' : 'transparent',
              border: m.role === 'user' ? '1px solid var(--border)' : 'none',
              borderRadius: 6,
              padding: m.role === 'user' ? '4px 8px' : 0,
            }}
          >
            {m.role === 'user' ? (
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.content}</div>
            ) : (
              <div style={{ fontSize: 13 }}>
                {splitSegments(m.content).map((seg, j) =>
                  seg.type === 'code' ? (
                    <CodeBlock key={j} segment={seg} onInsert={insert} readOnly={readOnly} />
                  ) : (
                    <div key={j} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {seg.text}
                    </div>
                  ),
                )}
                {busy && i === messages.length - 1 && <span style={{ color: 'var(--text-muted)' }}>▌</span>}
              </div>
            )}
          </div>
        ))}
        {error && <p style={{ fontSize: 12, color: 'var(--error, #c00)' }}>{error}</p>}
      </div>
      <div style={{ padding: '6px 8px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)' }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          Use my subscription:
          {SUBSCRIPTION_SITES.map((site) => (
            <button
              key={site.name}
              type="button"
              style={{ fontSize: 11, padding: '1px 6px' }}
              title={`Copy your question and the selected text (or the whole file), then open ${site.name}`}
              onClick={() => askElsewhere(site)}
            >
              {site.name}
            </button>
          ))}
        </div>
        {handedOff && <div style={{ marginTop: 4 }}>{handedOff}</div>}
      </div>
      <form onSubmit={send} style={{ display: 'flex', gap: 4, padding: 8, borderTop: '1px solid var(--border)' }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={busy ? 'Answering…' : 'Ask the assistant… (Shift+Enter for newline)'}
          rows={2}
          style={{ flex: 1, fontSize: 12, padding: 6, resize: 'none', fontFamily: 'inherit' }}
        />
        {busy ? (
          <button type="button" style={{ fontSize: 12 }} onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="submit" style={{ fontSize: 12 }}>
            Send
          </button>
        )}
      </form>
    </div>
  );
}
