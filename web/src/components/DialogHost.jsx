import { useEffect, useRef, useState } from 'react';
import { registerDialogHost } from '../lib/dialog.js';
import { usePresence } from '../lib/motion.js';

export default function DialogHost() {
  const [request, setRequest] = useState(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef(null);
  const confirmRef = useRef(null);
  const { mounted, shown } = usePresence(open, 220);

  useEffect(
    () =>
      registerDialogHost((next) => {
        setRequest(next);
        setValue(next.defaultValue ?? '');
        setOpen(true);
      }),
    []
  );

  useEffect(() => {
    if (!shown) return;
    if (request?.kind === 'prompt') {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      confirmRef.current?.focus();
    }
  }, [shown, request]);

  if (!mounted || !request) return null;

  function finish(result) {
    setOpen(false);
    request.resolve(result);
  }

  const isPrompt = request.kind === 'prompt';
  const text = value.trim();
  const canSubmit = !isPrompt || request.optional || text.length > 0;

  function submit(e) {
    e.preventDefault();
    if (canSubmit) finish(isPrompt ? text : true);
  }

  const cancel = () => finish(isPrompt ? null : false);
  const Field = request.multiline ? 'textarea' : 'input';

  return (
    <div
      className={`dialog-scrim${shown ? ' shown' : ''}`}
      onMouseDown={(e) => e.target === e.currentTarget && cancel()}
      onKeyDown={(e) => e.key === 'Escape' && cancel()}
    >
      <form className="dialog glass" role="dialog" aria-modal="true" aria-label={request.title} onSubmit={submit}>
        <h2>{request.title}</h2>
        {request.message && <p>{request.message}</p>}
        {isPrompt && (
          <Field
            ref={inputRef}
            value={value}
            placeholder={request.placeholder}
            rows={request.multiline ? 3 : undefined}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (request.multiline && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
            }}
          />
        )}
        <div className="dialog-actions">
          <button type="button" onClick={cancel}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="submit"
            disabled={!canSubmit}
            className={request.danger ? 'danger-button' : 'primary-button'}
          >
            {request.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
