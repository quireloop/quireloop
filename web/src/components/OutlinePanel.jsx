import { useState } from 'react';
import { ChevronIcon } from './Icons.jsx';

// Turns the flat list of headings into a tree: each heading owns the deeper
// ones after it, up to the next heading at its own level or above.
function nest(entries) {
  const root = { children: [] };
  const stack = [{ level: -1, node: root }];
  entries.forEach((entry, index) => {
    const node = { ...entry, key: `${index}:${entry.line}`, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= entry.level) stack.pop();
    stack[stack.length - 1].node.children.push(node);
    stack.push({ level: entry.level, node });
  });
  return root.children;
}

// Every heading starts folded, so a long paper opens to its top-level
// sections; the arrow opens one, clicking a title jumps to it.
export default function OutlinePanel({ entries, onJump }) {
  const [open, setOpen] = useState(() => new Set());
  const tree = nest(entries);

  function toggle(key) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderNodes(nodes, depth) {
    return nodes.map((node) => {
      const hasChildren = node.children.length > 0;
      const isOpen = open.has(node.key);
      return (
        <div key={node.key}>
          <div style={{ display: 'flex', alignItems: 'flex-start', paddingLeft: 4 + depth * 14 }}>
            <button
              onClick={() => hasChildren && toggle(node.key)}
              aria-label={hasChildren ? `${isOpen ? 'Fold' : 'Open'} ${node.title}` : undefined}
              aria-expanded={hasChildren ? isOpen : undefined}
              tabIndex={hasChildren ? 0 : -1}
              style={{
                width: 18,
                flexShrink: 0,
                padding: '4px 0',
                background: 'none',
                border: 'none',
                visibility: hasChildren ? 'visible' : 'hidden',
                transform: isOpen ? 'none' : 'rotate(-90deg)',
                transition: 'transform 120ms',
                cursor: 'pointer',
                color: 'var(--text-muted)',
              }}
            >
              <ChevronIcon />
            </button>
            <div
              onClick={() => onJump(node.line)}
              style={{ padding: '4px 6px', cursor: 'pointer', fontSize: 13, borderRadius: 4, wordBreak: 'break-word', flex: 1 }}
            >
              {node.title}
            </div>
          </div>
          {hasChildren && isOpen && renderNodes(node.children, depth + 1)}
        </div>
      );
    });
  }

  return (
    <div style={{ padding: 8, overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 8px' }}>
        <h4 style={{ margin: 0 }}>Outline</h4>
        {tree.some((n) => n.children.length > 0) && (
          <button
            onClick={() => setOpen(open.size ? new Set() : new Set(allKeys(tree)))}
            style={{ fontSize: 11 }}
          >
            {open.size ? 'Fold all' : 'Open all'}
          </button>
        )}
      </div>
      {entries.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 8px' }}>No sections found.</p>}
      {renderNodes(tree, 0)}
    </div>
  );
}

function allKeys(nodes) {
  return nodes.flatMap((n) => (n.children.length ? [n.key, ...allKeys(n.children)] : []));
}
