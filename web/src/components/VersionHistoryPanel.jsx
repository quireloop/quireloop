const TRIGGER_LABELS = {
  compile: 'Auto (compile)',
  manual: 'Saved',
  restore: 'Before restore',
};

export default function VersionHistoryPanel({ versions, onSave, onRestore, onClose }) {
  function handleSave() {
    const label = prompt('Label for this version (optional):');
    onSave(label || undefined);
  }

  function handleRestore(v) {
    if (confirm(`Restore to this version (${new Date(v.createdAt).toLocaleString()})? Your current state will be saved first.`)) {
      onRestore(v.id);
    }
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 40,
        right: 8,
        background: 'var(--panel-bg)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: 12,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 10,
        width: 320,
        maxHeight: 400,
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Version History</strong>
        <button onClick={onClose} style={{ fontSize: 12 }}>
          Close
        </button>
      </div>
      <button onClick={handleSave} style={{ fontSize: 12, marginBottom: 8, width: '100%' }}>
        Save current version
      </button>
      {versions.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No versions yet — compile or save one.</p>}
      {versions.map((v) => (
        <div key={v.id} style={{ padding: '6px 4px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
          <div>
            <strong>{v.label || TRIGGER_LABELS[v.trigger] || v.trigger}</strong>
          </div>
          <div style={{ color: 'var(--text-muted)' }}>{new Date(v.createdAt).toLocaleString()}</div>
          <button onClick={() => handleRestore(v)} style={{ fontSize: 11, marginTop: 4 }}>
            Restore
          </button>
        </div>
      ))}
    </div>
  );
}
