import { useEffect, useRef } from 'react';

// Closes a popover (Share, History, Insert symbol) when the user clicks
// anywhere outside it or presses Escape, as the Menu and Edit drop-downs do.
//
// `ref` should wrap the popover *and* the button that opens it: otherwise the
// mousedown on that button closes it and the click that follows reopens it.
// A confirm dialog the popover opened ("Restore this version?") sits outside
// it in the page, so clicks and keys there are left to the dialog.
export function useDismiss(ref, open, onClose) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const inDialog = () => document.querySelector('.dialog-scrim') !== null;
    function onMouseDown(e) {
      if (ref.current?.contains(e.target) || inDialog()) return;
      onCloseRef.current();
    }
    function onKeyDown(e) {
      if (e.key === 'Escape' && !inDialog()) onCloseRef.current();
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [ref, open]);
}
