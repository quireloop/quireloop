import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { WebSocket } from 'ws';

const REQUEST_TIMEOUT_MS = 60 * 1000;

function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

// A device token sent over plain http could be read by anyone on the network,
// so http is accepted only for a server on this same computer.
export function normalizeServerUrl(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    throw new Error('that is not a valid server address');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new Error('the server address must start with https://');
  }
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

function pemFromRaw(raw) {
  const body = raw.toString('base64').match(/.{1,64}/g).join('\n');
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`;
}

// Says whether the server's certificate is one the system already trusts. A lab
// server often has a self-signed one, which the person can choose to trust; the
// connection then accepts that exact certificate and no other.
export function probeServer(serverUrl) {
  const url = new URL(serverUrl);
  if (url.protocol !== 'https:') return Promise.resolve({ trusted: true });
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: url.hostname,
      port: url.port || 443,
      servername: url.hostname,
      rejectUnauthorized: false,
      timeout: 10_000,
    });
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      const trusted = socket.authorized;
      socket.destroy();
      resolve({
        trusted,
        fingerprint: cert.fingerprint256,
        pem: pemFromRaw(cert.raw),
        subject: cert.subject?.CN ?? '',
        expires: cert.valid_to,
      });
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('the server did not answer'));
    });
    socket.once('error', () => reject(new Error('could not reach that server')));
  });
}

function pinOptions(connection) {
  if (!connection.pin) return {};
  return {
    ca: connection.pin.pem,
    // The system's name check can't apply to a certificate that names the
    // machine rather than its address. Matching the exact one replaces it.
    checkServerIdentity: (_host, cert) =>
      cert.fingerprint256 === connection.pin.fingerprint ? undefined : new Error('the server certificate changed'),
  };
}

// Sends one request. Network trouble rejects with `offline` set, which the
// sync loop treats as "try later" rather than as a failure.
export function request(connection, method, route, { json, body, headers = {} } = {}) {
  const url = new URL(connection.url + route);
  const payload = json !== undefined ? Buffer.from(JSON.stringify(json)) : body;
  const options = {
    method,
    headers: {
      authorization: `Bearer ${connection.token}`,
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(payload ? { 'content-length': payload.length } : {}),
      ...headers,
    },
    timeout: REQUEST_TIMEOUT_MS,
    ...pinOptions(connection),
  };
  const client = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const offline = (message) => Object.assign(new Error(message), { offline: true });
    const req = client.request(url, options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', (err) => reject(offline(err.message)));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const isJson = (res.headers['content-type'] ?? '').includes('application/json');
        const parsed = isJson && buffer.length ? JSON.parse(buffer.toString()) : buffer;
        if (res.statusCode >= 400) {
          const message = parsed?.error ?? `the server answered ${res.statusCode}`;
          reject(Object.assign(new Error(message), { status: res.statusCode }));
        } else {
          resolve(parsed);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', (err) => reject(offline(err.message)));
    req.end(payload);
  });
}

export function openSocket(connection, route) {
  const url = new URL(connection.url + route);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return new WebSocket(url, {
    headers: { authorization: `Bearer ${connection.token}` },
    handshakeTimeout: 15_000,
    ...pinOptions(connection),
  });
}
