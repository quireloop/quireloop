import { useEffect, useState } from 'react';
import { linkApi } from '../api.js';

// Shown on the server, where the person is signed in. Approving gives that
// computer a copy of every paper they can open, so the page says so plainly.
export default function LinkDevicePage({ code, onDone }) {
  const [pairing, setPairing] = useState(null);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    linkApi.describe(code).then(setPairing).catch((err) => setError(err.message));
  }, [code]);

  async function approve() {
    setError('');
    try {
      await linkApi.approve(code);
      setApproved(true);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div style={{ maxWidth: 460, margin: '80px auto', padding: '0 16px' }}>
      <h2>Link a computer</h2>
      {approved ? (
        <p>Done. You can close this page and go back to Quireloop on your computer.</p>
      ) : pairing ? (
        <>
          <p>
            <strong>{pairing.deviceName}</strong> is asking to keep a copy of every paper you can open here, and to
            send your changes back.
          </p>
          <p>
            Check that your computer shows this code: <code>{code}</code>
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Approve only if you started this yourself, on your own computer. If someone sent you this link, cancel.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary-button" onClick={approve}>
              Approve
            </button>
            <button onClick={onDone}>Cancel</button>
          </div>
        </>
      ) : null}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {(error || approved) && <button onClick={onDone}>Go to your projects</button>}
    </div>
  );
}
