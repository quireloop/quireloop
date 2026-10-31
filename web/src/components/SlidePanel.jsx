import { usePresence } from '../lib/motion.js';

// A side panel that glides in from the edge, pushing the workspace over,
// instead of snapping the layout to a new width.
export default function SlidePanel({ open, width, children }) {
  const { mounted, shown } = usePresence(open);
  if (!mounted) return null;
  return (
    <div className="slide-panel" style={{ width: shown ? width : 0 }}>
      <div style={{ width, height: '100%', display: 'flex' }}>{children}</div>
    </div>
  );
}
