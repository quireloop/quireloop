import { useState } from 'react';

function timeLabel(iso) {
  return new Date(iso).toLocaleString();
}

function Thread({ thread, currentUserId, isOwner, onSelect, onReply, onResolve, onDelete }) {
  const [replyText, setReplyText] = useState('');
  const first = thread.messages[0];
  const canDelete = isOwner || thread.createdBy === currentUserId;

  function submitReply(e) {
    e.preventDefault();
    if (!replyText.trim()) return;
    onReply(thread.id, replyText.trim());
    setReplyText('');
  }

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: 8,
        marginBottom: 8,
        opacity: thread.resolved ? 0.6 : 1,
      }}
    >
      <div
        onClick={() => onSelect(thread)}
        style={{ cursor: thread.orphaned ? 'default' : 'pointer', marginBottom: 4 }}
        title={thread.orphaned ? 'The commented text was deleted' : 'Click to jump to this range'}
      >
        {thread.orphaned && (
          <span style={{ fontSize: 11, color: '#e0a030', display: 'block' }}>⚠ Orphaned — text no longer exists</span>
        )}
        {thread.messages.map((m) => (
          <div key={m.id} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              <strong>{m.email}</strong> · {timeLabel(m.at)}
            </div>
            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{m.text}</div>
          </div>
        ))}
      </div>
      <form onSubmit={submitReply} style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <input
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          placeholder="Reply…"
          style={{ flex: 1, fontSize: 12, padding: 4 }}
        />
        <button type="submit" style={{ fontSize: 12 }}>
          Send
        </button>
      </form>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button onClick={() => onResolve(thread.id, !thread.resolved)} style={{ fontSize: 11 }}>
          {thread.resolved ? 'Reopen' : 'Resolve'}
        </button>
        {canDelete && (
          <button onClick={() => onDelete(thread.id)} style={{ fontSize: 11 }}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

export default function CommentsPanel({
  threads,
  showResolved,
  onToggleShowResolved,
  currentUserId,
  isOwner,
  onSelectThread,
  onReply,
  onResolve,
  onDelete,
  onClose,
}) {
  const visible = threads.filter((t) => showResolved || !t.resolved);

  return (
    <div
      style={{
        width: 300,
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
        <strong style={{ fontSize: 13 }}>Comments</strong>
        <button onClick={onClose} style={{ fontSize: 12 }}>
          Close
        </button>
      </div>
      <label style={{ fontSize: 11, padding: '6px 8px', color: 'var(--text-muted)', display: 'flex', gap: 4, alignItems: 'center' }}>
        <input type="checkbox" checked={showResolved} onChange={onToggleShowResolved} />
        Show resolved
      </label>
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {visible.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            No comments yet — select some text and click "Comment" to start a thread.
          </p>
        )}
        {visible.map((t) => (
          <Thread
            key={t.id}
            thread={t}
            currentUserId={currentUserId}
            isOwner={isOwner}
            onSelect={onSelectThread}
            onReply={onReply}
            onResolve={onResolve}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}
