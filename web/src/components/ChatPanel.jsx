import { useState } from 'react';

function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatPanel({ messages, currentUserId, onSend, onClose }) {
  const [text, setText] = useState('');

  function submit(e) {
    e?.preventDefault();
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
  }

  return (
    <div
      style={{
        width: 280,
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
        <strong style={{ fontSize: 13 }}>Project Chat</strong>
        <button onClick={onClose} style={{ fontSize: 12 }}>
          Close
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {messages.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No messages yet — say hello.</p>}
        {messages.map((m) => {
          const own = m.userId === currentUserId;
          return (
            <div
              key={m.id}
              style={{
                alignSelf: own ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                background: own ? 'var(--accent-bg)' : 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '4px 8px',
              }}
            >
              {!own && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{m.email}</div>}
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.text}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: own ? 'right' : 'left' }}>
                {timeLabel(m.at)}
              </div>
            </div>
          );
        })}
      </div>
      <form onSubmit={submit} style={{ display: 'flex', gap: 4, padding: 8, borderTop: '1px solid var(--border)' }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message the project…"
          style={{ flex: 1, fontSize: 12, padding: 6 }}
        />
        <button type="submit" style={{ fontSize: 12 }}>
          Send
        </button>
      </form>
    </div>
  );
}
