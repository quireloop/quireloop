function timeLabel(iso) {
  return new Date(iso).toLocaleString();
}

function Suggestion({ suggestion, canWrite, onAccept, onReject }) {
  const isDelete = suggestion.type === 'delete';

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: 8,
        marginBottom: 8,
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
        {isDelete ? '➖ Deletion' : '➕ Insertion'} · <strong>{suggestion.createdByEmail}</strong> ·{' '}
        {timeLabel(suggestion.createdAt)}
      </div>
      <div
        style={{
          fontSize: 13,
          whiteSpace: 'pre-wrap',
          fontFamily: 'ui-monospace, monospace',
          textDecoration: isDelete ? 'line-through' : 'none',
          background: isDelete ? 'rgba(220, 70, 70, 0.12)' : 'rgba(60, 200, 90, 0.15)',
          borderRadius: 4,
          padding: '4px 6px',
          maxHeight: 120,
          overflowY: 'auto',
        }}
      >
        {suggestion.text || '(empty)'}
      </div>
      {canWrite && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button onClick={() => onAccept(suggestion)} style={{ fontSize: 11 }}>
            Accept
          </button>
          <button onClick={() => onReject(suggestion)} style={{ fontSize: 11 }}>
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

export default function SuggestionsPanel({ suggestions, canWrite, onAccept, onReject, onClose }) {
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
        <strong style={{ fontSize: 13 }}>Suggestions</strong>
        <button onClick={onClose} style={{ fontSize: 12 }}>
          Close
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {suggestions.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            No pending suggestions — turn on Suggest mode to have your edits recorded as
            insertions/deletions for others to accept or reject.
          </p>
        )}
        {suggestions.map((s) => (
          <Suggestion key={s.id} suggestion={s} canWrite={canWrite} onAccept={onAccept} onReject={onReject} />
        ))}
      </div>
    </div>
  );
}
