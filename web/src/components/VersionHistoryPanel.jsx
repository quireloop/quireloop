import { confirmDialog, promptDialog } from '../lib/dialog.js';
import { useState } from 'react';
import VersionDiffModal from './VersionDiffModal.jsx';

const TRIGGER_LABELS = {
  compile: 'Auto (compile)',
  manual: 'Saved',
  restore: 'Before restore',
};

export default function VersionHistoryPanel({ projectId, versions, files, readOnly, onSave, onRestore, onClose }) {
  const [diffVersion, setDiffVersion] = useState(null);

  async function handleSave() {
    const label = await promptDialog({
      title: 'Save this version',
      placeholder: 'Label (optional)',
      confirmLabel: 'Save',
      optional: true,
    });
    if (label !== null) onSave(label || undefined);
  }

  async function handleRestore(v) {
    const confirmed = await confirmDialog({
      title: 'Restore this version?',
      message: `${new Date(v.createdAt).toLocaleString()}. Your current state will be saved first.`,
      confirmLabel: 'Restore',
    });
    if (confirmed) onRestore(v.id);
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
      {!readOnly && (
        <button onClick={handleSave} style={{ fontSize: 12, marginBottom: 8, width: '100%' }}>
          Save current version
        </button>
      )}
      {versions.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No versions yet — compile or save one.</p>}
      {versions.map((v) => (
        <div key={v.id} style={{ padding: '6px 4px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
          <div>
            <strong>{v.label || TRIGGER_LABELS[v.trigger] || v.trigger}</strong>
          </div>
          <div style={{ color: 'var(--text-muted)' }}>{new Date(v.createdAt).toLocaleString()}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button onClick={() => setDiffVersion(v)} style={{ fontSize: 11 }}>
              Diff
            </button>
            {!readOnly && (
              <button onClick={() => handleRestore(v)} style={{ fontSize: 11 }}>
                Restore
              </button>
            )}
          </div>
        </div>
      ))}
      {diffVersion && (
        <VersionDiffModal
          projectId={projectId}
          version={diffVersion}
          liveFiles={files}
          onClose={() => setDiffVersion(null)}
        />
      )}
    </div>
  );
}
