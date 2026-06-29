// Integration test: REAL NATS STARTTLS handshake against the plugin's TLS path.
//
// NATS upgrades an already-open plaintext socket to TLS after the server's
// first INFO line. This test stands up a plaintext server that (1) sends an
// INFO line, then (2) upgrades ITS side of the same socket to a TLS server
// socket presenting a runtime self-signed cert, and drives the built
// NatsClient through the STARTTLS upgrade, asserting:
//   • positive: the server observes a completed TLS handshake when the client
//     trusts the cert (rejectUnauthorized:false, or tlsCa supplied);
//   • negative: the STARTTLS upgrade is REJECTED when verification is on and
//     the cert is untrusted.
//
// Self-signed cert generated at runtime in the OS temp dir via system openssl
// (never committed). Suite SKIPS if openssl is unavailable. Opt-in (`.it.`);
// not wired into the required gate.
//
// Run:  npm run build -w packages/plugin-nats && node --test packages/plugin-nats/test/tls-handshake.it.test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as netServer } from 'node:net';
import { TLSSocket } from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { NatsClient } from '../dist/index.js';

let opensslAvailable = true;
let tmp; let caPem; let keyPem; let server; let port;
let onSecure = () => {};

before(() => {
  try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); }
  catch { opensslAvailable = false; return; }
  tmp = mkdtempSync(join(tmpdir(), 'nats-tls-it-'));
  const keyPath = join(tmp, 'key.pem');
  const certPath = join(tmp, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=localhost',
  ], { stdio: 'ignore' });
  caPem = readFileSync(certPath, 'utf8');
  keyPem = readFileSync(keyPath, 'utf8');
  return new Promise((resolve) => {
    server = netServer((socket) => {
      socket.on('error', () => {});
      // 1) Plaintext INFO line, then 2) upgrade our side to a TLS server socket.
      socket.write('INFO {"server_id":"streetjs-test","version":"2.0.0"}\r\n');
      const tlsSock = new TLSSocket(socket, { isServer: true, key: keyPem, cert: caPem });
      tlsSock.on('secure', () => onSecure());
      tlsSock.on('error', () => {});
      tlsSock.on('data', (d) => { if (d.toString('utf8').includes('PING')) tlsSock.write('PONG\r\n'); });
    });
    server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });
});

after(() => { if (server) server.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

function handshakeObserved(timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no TLS handshake observed')), timeoutMs);
    onSecure = () => { clearTimeout(t); resolve(true); };
  });
}

test('1) STARTTLS upgrade completes a TLS handshake with rejectUnauthorized:false', { skip: !opensslAvailable && 'openssl unavailable' }, async () => {
  const client = new NatsClient({ host: '127.0.0.1', port, tls: true, tlsRejectUnauthorized: false, tlsServerName: 'localhost' });
  const observed = handshakeObserved();
  client.connect().catch(() => {});
  assert.equal(await observed, true);
  try { await client.close?.(); } catch { /* best-effort */ }
});

test('2) STARTTLS upgrade completes when the cert is supplied as a trusted CA', { skip: !opensslAvailable && 'openssl unavailable' }, async () => {
  const client = new NatsClient({ host: '127.0.0.1', port, tls: true, tlsRejectUnauthorized: true, tlsServerName: 'localhost', tlsCa: caPem });
  const observed = handshakeObserved();
  client.connect().catch(() => {});
  assert.equal(await observed, true);
  try { await client.close?.(); } catch { /* best-effort */ }
});

test('3) STARTTLS upgrade is REJECTED when verification is on and the cert is untrusted', { skip: !opensslAvailable && 'openssl unavailable' }, async () => {
  const client = new NatsClient({ host: '127.0.0.1', port, tls: true, tlsRejectUnauthorized: true, tlsServerName: 'localhost' });
  await assert.rejects(() => client.connect(), /connect failed|self.?signed|unable to verify|certificate/i);
});
