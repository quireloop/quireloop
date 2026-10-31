// In-app replacements for window.confirm and window.prompt. Any code can await
// these; components/DialogHost.jsx draws whichever one is current.
let show = null;

export function registerDialogHost(fn) {
  show = fn;
  return () => {
    show = null;
  };
}

function open(request) {
  return new Promise((resolve) => show?.({ ...request, resolve }));
}

export function confirmDialog({ title, message, confirmLabel = 'OK', danger = false }) {
  return open({ kind: 'confirm', title, message, confirmLabel, danger });
}

// Resolves to the trimmed text, or null if cancelled.
export function promptDialog({ title, message, defaultValue = '', placeholder, confirmLabel = 'OK', optional = false, multiline = false }) {
  return open({ kind: 'prompt', title, message, defaultValue, placeholder, confirmLabel, optional, multiline });
}
