// Integration test: REAL TLS handshake for the core Kafka + AMQP(RabbitMQ)
// transports (the plugin packages delegate their connections to these).
//
//   KafkaConnection.connect() resolves on the TLS handshake (no protocol step),
//     so both positive (handshake succeeds) and negative (untrusted cert
//     rejected) are asserted directly.
//   AmqpConnection.connect() resolves only after the full AMQP handshake, which
//     a bare TLS server cannot complete; therefore only the protocol-independent
//     NEGATIVE case (untrusted cert rejected at the TLS layer) is asserted here.
//     A positive AMQP assertion requires an AMQP-protocol server (follow-up).
//
// Self-signed cert generated at runtime in the OS temp dir via system openssl
// (never committed). Suite SKIPS if openssl is unavailable. Opt-in (`.it.`);
// not wired into the required gate.
//
// Run:  npm run build -w packages/core && node --test packages/core/test/transport-tls-handshake.it.test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { AmqpConnection } from '../dist/index.js';
import { KafkaConnection } from '../dist/transports/kafka/connection.js';

let opensslAvailable = true;
let tmp; let caPem; let server; let port;

before(() => {
  try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); }
  catch { opensslAvailable = false; return; }
  tmp = mkdtempSync(join(tmpdir(), 'transport-tls-it-'));
  const keyPath = join(tmp, 'key.pem');
  const certPath = join(tmp, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=localhost',
  ], { stdio: 'ignore' });
  caPem = readFileSync(certPath, 'utf8');
  const key = readFileSync(keyPath, 'utf8');
  return new Promise((resolve) => {
    server = createServer({ key, cert: caPem }, (socket) => { socket.on('data', () => {}); socket.on('error', () => {}); });
    server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });
});

after(() => { if (server) server.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

// ── Kafka transport (connect() resolves on the TLS handshake) ──
test('Kafka: TLS handshake succeeds with rejectUnauthorized:false', { skip: !opensslAvailable && 'openssl unavailable' }, async () => {
  const conn = new KafkaConnection({ host: '127.0.0.1', port, tls: true, tlsRejectUnauthorized: false, tlsServerName: 'localhost', connectTimeoutMs: 4000 });
  await conn.connect();
  try { conn.close?.(); } catch { /* best-effort */ }
});

test('Kafka: TLS handshake succeeds when the cert is supplied as a trusted CA', { skip: !opensslAvailable && 'openssl unavailable' }, async () => {
  const conn = new KafkaConnection({ host: '127.0.0.1', port, tls: true, tlsRejectUnauthorized: true, tlsServerName: 'localhost', tlsCa: caPem, connectTimeoutMs: 4000 });
  await conn.connect();
  try { conn.close?.(); } catch { /* best-effort */ }
});

test('Kafka: TLS handshake is REJECTED when verification is on and the cert is untrusted', { skip: !opensslAvailable && 'openssl unavailable' }, async () => {
  const conn = new KafkaConnection({ host: '127.0.0.1', port, tls: true, tlsRejectUnauthorized: true, tlsServerName: 'localhost', connectTimeoutMs: 4000 });
  await assert.rejects(() => conn.connect(), /self.?signed|unable to verify|certificate/i);
});

// ── AMQP (RabbitMQ) transport — negative is protocol-independent ──
test('AMQP: TLS handshake is REJECTED when verification is on and the cert is untrusted', { skip: !opensslAvailable && 'openssl unavailable' }, async () => {
  const conn = new AmqpConnection({ host: '127.0.0.1', port, tls: true, tlsRejectUnauthorized: true, tlsServerName: 'localhost', connectTimeoutMs: 4000 });
  await assert.rejects(() => conn.connect(), /self.?signed|unable to verify|certificate/i);
});
