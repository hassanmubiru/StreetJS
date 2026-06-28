// Integration test: REAL TLS handshake against the Redis plugin's TLS path.
//
// Unlike test/tls-config.test.mjs (which only validates config parsing), this
// stands up an in-process TLS server speaking minimal RESP and drives the
// built RedisClient over an actual TLS handshake, asserting:
//   1. tls:true + tlsRejectUnauthorized:false  -> handshake succeeds, PING ok
//   2. tls:true + tlsCa=<server cert> (trusted) -> handshake succeeds
//   3. tls:true + tlsRejectUnauthorized:true, no CA -> handshake REJECTED
//
// The self-signed cert is generated at runtime into the OS temp dir via the
// system `openssl` (never committed — avoids secret-scanner false positives).
// The whole suite SKIPS cleanly if `openssl` is unavailable, so CI without it
// is unaffected. This is an opt-in integration test (file suffix `.it.`), not
// wired into the required unit-test/coverage gate.
//
// Run:  npm run build -w packages/plugin-redis && node --test packages/plugin-redis/test/tls-handshake.it.test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { RedisClient } from '../dist/index.js';

let opensslAvailable = true;
let tmp;
let caPem;
let server;
let port;

// Minimal RESP responder: enough to satisfy connect()+ping()+quit().
function respond(socket, chunk) {
  const s = chunk.toString('utf8').toUpperCase();
  if (s.includes('QUIT')) { socket.write('+OK\r\n'); return; }
  if (s.includes('AUTH') || s.includes('SELECT')) { socket.write('+OK\r\n'); return; }
  if (s.includes('PING')) { socket.write('+PONG\r\n'); return; }
  socket.write('+OK\r\n');
}

before(() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
  } catch {
    opensslAvailable = false;
    return;
  }
  tmp = mkdtempSync(join(tmpdir(), 'redis-tls-it-'));
  const keyPath = join(tmp, 'key.pem');
  const certPath = join(tmp, 'cert.pem');
  // Self-signed cert for CN=localhost, valid 1 day. Runtime-only, tmp dir.
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath, '-days', '1',
    '-subj', '/CN=localhost',
  ], { stdio: 'ignore' });
  caPem = readFileSync(certPath, 'utf8');
  const key = readFileSync(keyPath, 'utf8');

  return new Promise((resolve) => {
    server = createServer({ key, cert: caPem }, (socket) => {
      socket.on('data', (chunk) => respond(socket, chunk));
      socket.on('error', () => {});
    });
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    });
  });
});

after(() => {
  if (server) server.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test('1) TLS handshake succeeds with rejectUnauthorized:false; PING returns PONG', { skip: !opensslAvailable && 'openssl unavailable' }, async () => {
  const client = new RedisClient({
    host: '127.0.0.1', port,
    tls: true, tlsRejectUnauthorized: false, tlsServerName: 'localhost',
  });
  await client.connect();
  const reply = await client.ping();
  assert.equal(reply, 'PONG');
  await client.quit();
});

test('2) TLS handshake succeeds when the self-signed cert is supplied as a trusted CA', { skip: !opensslAvailable && 'openssl unavailable' }, async () => {
  const client = new RedisClient({
    host: '127.0.0.1', port,
    tls: true, tlsRejectUnauthorized: true, tlsServerName: 'localhost', tlsCa: caPem,
  });
  await client.connect();
  assert.equal(await client.ping(), 'PONG');
  await client.quit();
});

test('3) TLS handshake is REJECTED when verification is on and the cert is untrusted', { skip: !opensslAvailable && 'openssl unavailable' }, async () => {
  const client = new RedisClient({
    host: '127.0.0.1', port,
    tls: true, tlsRejectUnauthorized: true, tlsServerName: 'localhost',
    // no tlsCa -> self-signed cert is not trusted -> handshake must fail
  });
  await assert.rejects(() => client.connect(), /connect failed|self.?signed|unable to verify|certificate/i);
});
