import { useEffect, useMemo, useRef, useState } from 'react';
import { usePresence } from '../lib/motion.js';

// Letters of the query must appear in order; earlier, tighter matches rank first.
function score(label, query) {
  const text = label.toLowerCase();
  let from = 0;
  let first = -1;
  let last = 0;
  for (const ch of query) {
    const at = text.indexOf(ch, from);
    if (at < 0) return null;
    if (first < 0) first = at;
    last = at;
    from = at + 1;
  }
  return first + (last - first);
}

// commands: [{ id, label, hint, run }]
export default function CommandPalette({ open, onClose, commands }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const { mounted, shown } = usePresence(open, 220);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
  }, [open]);

  useEffect(() => {
    if (shown) inputRef.current?.focus();
  }, [shown]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands
      .map((command) => ({ command, rank: score(command.label, q) }))
      .filter((r) => r.rank !== null)
      .sort((a, b) => a.rank - b.rank)
      .map((r) => r.command);
  }, [commands, query]);

  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!mounted) return null;

  function choose(command) {
    onClose();
    command?.run();
  }

  function handleKey(e) {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[index]);
    }
  }

  return (
    <div className={`dialog-scrim palette-scrim${shown ? ' shown' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette glass" role="dialog" aria-label="Commands">
        <input
          ref={inputRef}
          value={query}
          placeholder="Search commands and files…"
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={handleKey}
        />
        <div className="palette-list" ref={listRef}>
          {results.map((command, i) => (
            <button
              key={command.id}
              className={i === index ? 'selected' : ''}
              onMouseMove={() => setIndex(i)}
              onClick={() => choose(command)}
            >
              <span>{command.label}</span>
              {command.hint && <kbd>{command.hint}</kbd>}
            </button>
          ))}
          {results.length === 0 && <p>No matches</p>}
        </div>
      </div>
    </div>
  );
}
