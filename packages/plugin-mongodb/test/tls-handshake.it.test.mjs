// Integration test: REAL TLS handshake against the MongoDB plugin's TLS path.
//
// Drives the built MongoClient over an actual TLS handshake against an
// in-process TLS server. MongoClient.connect() resolves on TLS connect and
// THEN issues a `hello` handshake (which a bare TLS server cannot answer), so:
//   • positive cases assert the SERVER observed a completed TLS handshake
//     (proof the client negotiated TLS), then tear down — the later `hello`
//     rejection is swallowed;
//   • the negative case asserts connect() REJECTS at the TLS layer (cert
//     verification) BEFORE any `hello`, which is protocol-independent.
//
// Self-signed cert is generated at runtime into the OS temp dir via system
// `openssl` (never committed). The suite SKIPS if `openssl` is unavailable.
// Opt-in integration test (`.it.` suffix); not wired into the required gate.
//
// Run:  npm run build -w packages/plugin-mongodb && node --test packages/plugin-mongodb/test/tls-handshake.it.test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { MongoClient } from '../dist/index.js';

let opensslAvailable = true;
let tmp; let caPem; let server; let port;

before(() => {
  try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); }
  catch { opensslAvailable = false; return; }
  tmp = mkdtempSync(join(tmpdir(), 'mongo-tls-it-'));
  const keyPath = join(tmp, 'key.pem');
  const certPath = join(tmp, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=localhost',
  ], { stdio: 'ignore' });
  caPem = readFileSync(certPath, 'utf8');
  const key = readFileSync(keyPath, 'utf8');
  return new Promise((resolve) => {
    // Drain client bytes; never answer `hello` (we only assert the handshake).
    server = createServer({ key, cert: caPem }, (socket) => { socket.on('data', () => {}); socket.on('error', () => {}); });
    server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });
});

after(() => { if (server) server.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

// Resolve when the server observes a completed TLS handshake from the client.
function handshakeObserved(timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no TLS handshake observed')), timeoutMs);
    server.once('secureConnection', () => { clearTimeout(t); resolve(true); });
  });
}

test('1) client negotiates a TLS handshake with rejectUnauthorized:false', { skip: !opensslAvailable && 'openssl unavailable' }, async () => {
  const client = new MongoClient({ host: '127.0.0.1', port, tls: true, tlsRejectUnauthorized: false, tlsServerName: 'localhost' });
  const observed = handshakeObserved();
  // connect() will later reject on the unanswered `hello`; swallow that.
  client.connect().catch(() => {});
  assert.equal(await observed, true);
  try { await client.close?.(); } catch { /* best-effort teardown */ }
});

test('2) client negotiates a TLS handshake when the cert is supplied as a trusted CA', { skip: !opensslAvailable && 'openssl unavailable' }, async () => {
  const client = new MongoClient({ host: '127.0.0.1', port, tls: true, tlsRejectUnauthorized: true, tlsServerName: 'localhost', tlsCa: caPem });
  const observed = handshakeObserved();
  client.connect().catch(() => {});
  assert.equal(await observed, true);
  try { await client.close?.(); } catch { /* best-effort */ }
});

test('3) TLS handshake is REJECTED when verification is on and the cert is untrusted', { skip: !opensslAvailable && 'openssl unavailable' }, async () => {
  const client = new MongoClient({ host: '127.0.0.1', port, tls: true, tlsRejectUnauthorized: true, tlsServerName: 'localhost' });
  await assert.rejects(() => client.connect(), /connect failed|self.?signed|unable to verify|certificate/i);
});
