import { useEffect, useRef, useState } from 'react';

// Small dropdown used to group related toolbar actions (File-ish stuff,
// Edit/collaboration stuff) behind a single "Menu"/"Edit" button instead of
// a flat row of 18 buttons — same idea as any desktop app's menu bar.
export default function ToolbarMenu({ label, badge, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

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
      <button onClick={() => setOpen((v) => !v)} style={{ fontSize: 13, position: 'relative' }}>
        {label} <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
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
      {open && (
        <div
          className="pop-in"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 6,
            background: 'var(--panel-bg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            padding: 6,
            minWidth: 220,
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
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
      style={{
        fontSize: 13,
        textAlign: 'left',
        border: 'none',
        boxShadow: 'none',
        background: active ? 'var(--accent-bg)' : 'transparent',
        padding: '7px 10px',
        borderRadius: 'var(--radius-sm)',
        width: '100%',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
      }}
    >
      {children}
    </button>
  );
}
