import * as Y from 'yjs';

// Comment anchors are Yjs relative positions — they follow the text they
// were attached to through concurrent inserts/deletes elsewhere in the
// doc, which a plain character offset couldn't. Encoded as base64 so they
// travel as opaque strings through the JSON API; the server never
// interprets them.
function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeAnchor(ytext, from, to) {
  const start = Y.createRelativePositionFromTypeIndex(ytext, from);
  const end = Y.createRelativePositionFromTypeIndex(ytext, to);
  return {
    start: bytesToBase64(Y.encodeRelativePosition(start)),
    end: bytesToBase64(Y.encodeRelativePosition(end)),
  };
}

// Returns { from, to } absolute character offsets in the live doc, or null
// if either end can't be resolved (e.g. the anchored text was deleted) —
// callers show that as an "orphaned" thread.
export function decodeAnchor(ydoc, anchor) {
  try {
    const startRel = Y.decodeRelativePosition(base64ToBytes(anchor.start));
    const endRel = Y.decodeRelativePosition(base64ToBytes(anchor.end));
    const start = Y.createAbsolutePositionFromRelativePosition(startRel, ydoc);
    const end = Y.createAbsolutePositionFromRelativePosition(endRel, ydoc);
    if (!start || !end) return null;
    return { from: start.index, to: end.index };
  } catch {
    return null;
  }
}
