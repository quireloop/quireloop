export default function OutlinePanel({ entries, onJump }) {
  return (
    <div style={{ padding: 8, overflowY: 'auto', height: '100%' }}>
      <h4 style={{ margin: '4px 8px' }}>Outline</h4>
      {entries.length === 0 && <p style={{ fontSize: 12, color: '#666', margin: '4px 8px' }}>No sections found.</p>}
      {entries.map((e, i) => (
        <div
          key={i}
          onClick={() => onJump(e.line)}
          style={{
            padding: '4px 8px',
            paddingLeft: 8 + e.level * 14,
            cursor: 'pointer',
            fontSize: 13,
            borderRadius: 4,
            wordBreak: 'break-word',
          }}
        >
          {e.title}
        </div>
      ))}
    </div>
  );
}
