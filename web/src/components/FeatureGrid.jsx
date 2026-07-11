const FEATURES = [
  {
    icon: '⚡',
    title: 'Real-time collaboration',
    body: 'See collaborators’ cursors and edits as they type — no refresh, no merge conflicts.',
  },
  {
    icon: '🔒',
    title: 'Self-hosted',
    body: 'Runs on your own server. Your papers never touch a third party’s cloud.',
  },
  {
    icon: '🌿',
    title: 'Git-backed projects',
    body: 'Every project is a real git repo — push, pull, and keep your own history.',
  },
  {
    icon: '👥',
    title: 'Granular sharing',
    body: 'Invite collaborators by email. Owners decide who gets access, and can revoke it instantly.',
  },
  {
    icon: '✍️',
    title: 'Smart LaTeX editing',
    body: 'Command, environment, and \\cite{} autocomplete, a symbol palette, and synced PDF preview.',
  },
  {
    icon: '📖',
    title: 'Open source',
    body: 'MIT-licensed. Read the code, self-host it, or send a pull request.',
  },
];

export default function FeatureGrid() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 16,
        maxWidth: 920,
        margin: '0 auto',
      }}
    >
      {FEATURES.map((f) => (
        <div
          key={f.title}
          style={{
            background: 'var(--panel-bg)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 18,
          }}
        >
          <div style={{ fontSize: 22, marginBottom: 8 }}>{f.icon}</div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{f.title}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>{f.body}</div>
        </div>
      ))}
    </div>
  );
}
