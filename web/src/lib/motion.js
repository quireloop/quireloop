import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

export const MOTION_MS = 340;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// Runs a state change as a cross-fade between the old and new screen. Browsers
// without the View Transitions API simply apply the change.
export function withTransition(update) {
  if (!document.startViewTransition || reducedMotion()) {
    update();
    return;
  }
  document.startViewTransition(() => flushSync(update));
}

// Keeps something mounted long enough to animate out. `shown` flips a frame
// after mounting, so a CSS transition has a start state to run from.
export function usePresence(open, duration = MOTION_MS) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), duration);
    return () => clearTimeout(timer);
  }, [open, duration]);

  return { mounted, shown };
}
