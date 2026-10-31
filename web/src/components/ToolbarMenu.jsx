import { useEffect, useRef, useState } from 'react';
import { ChevronIcon } from './Icons.jsx';
import { usePresence } from '../lib/motion.js';

// Small dropdown used to group related toolbar actions (File-ish stuff,
// Edit/collaboration stuff) behind a single "Menu"/"Edit" button instead of
// a flat row of 18 buttons — same idea as any desktop app's menu bar.
export default function ToolbarMenu({ label, badge, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { mounted, shown } = usePresence(open, 160);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen((v) => !v)} className="menu-trigger" aria-expanded={open}>
        {label} <ChevronIcon />
        {badge > 0 && (
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
            {badge}
          </span>
        )}
      </button>
      {mounted && (
        <div
          className={`menu-surface glass${shown ? ' shown' : ''}`}
          // Choosing something closes the menu, as a desktop menu would. The
          // compiler <select> is left out so it stays open while in use.
          onClick={(e) => {
            e.stopPropagation();
            if (e.target.closest('button, a')) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// A single row inside a ToolbarMenu — plain button stripped of the default
// bordered/boxed look so a stack of them reads as a menu, not a toolbar.
export function MenuItem({ onClick, active, disabled, title, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`menu-item${active ? ' active' : ''}`}
    >
      {children}
    </button>
  );
}
