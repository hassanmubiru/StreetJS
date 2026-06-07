// tests/mtls.test.ts
// Mutual-TLS verification. Generates a real CA + server cert + client cert with
// openssl, performs genuine mTLS handshakes, and asserts the validation/pinning
// logic. Skips gracefully if openssl is unavailable.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { once } from 'node:events';
import {
  createMutualTlsServer, validateClientCert, certificateFingerprint, verifyCertificatePin,
  clientCertMiddleware, TrustStore, rotateServerCertificate, type PeerCertLike,
} from '../security/mtls.js';

let tmp = '';
let opensslOk = false;

function sh(cmd: string, args: string[]): void {
  execFileSync(cmd, args, { stdio: 'pipe' });
}

before(() => {
  try {
    tmp = mkdtempSync(join(tmpdir(), 'mtls-'));
    const f = (n: string) => join(tmp, n);
    // CA
    sh('openssl', ['genrsa', '-out', f('ca.key'), '2048']);
    sh('openssl', ['req', '-x509', '-new', '-nodes', '-key', f('ca.key'), '-sha256', '-days', '2', '-subj', '/CN=Street-Test-CA', '-out', f('ca.crt')]);
    // Server cert signed by CA, with a SAN for 127.0.0.1 via an extension file.
    writeFileSync(f('san.cnf'), 'subjectAltName=IP:127.0.0.1\n');
    sh('openssl', ['genrsa', '-out', f('server.key'), '2048']);
    sh('openssl', ['req', '-new', '-key', f('server.key'), '-subj', '/CN=127.0.0.1', '-out', f('server.csr')]);
    sh('openssl', ['x509', '-req', '-in', f('server.csr'), '-CA', f('ca.crt'), '-CAkey', f('ca.key'), '-CAcreateserial', '-days', '2', '-sha256', '-extfile', f('san.cnf'), '-out', f('server.crt')]);
    // Client cert signed by the same CA.
    sh('openssl', ['genrsa', '-out', f('client.key'), '2048']);
    sh('openssl', ['req', '-new', '-key', f('client.key'), '-subj', '/CN=street-client', '-out', f('client.csr')]);
    sh('openssl', ['x509', '-req', '-in', f('client.csr'), '-CA', f('ca.crt'), '-CAkey', f('ca.key'), '-CAcreateserial', '-days', '2', '-sha256', '-out', f('client.crt')]);
    // A SECOND CA + client signed by it, for rotation tests.
    sh('openssl', ['genrsa', '-out', f('ca2.key'), '2048']);
    sh('openssl', ['req', '-x509', '-new', '-nodes', '-key', f('ca2.key'), '-sha256', '-days', '2', '-subj', '/CN=Street-Test-CA-2', '-out', f('ca2.crt')]);
    sh('openssl', ['genrsa', '-out', f('client2.key'), '2048']);
    sh('openssl', ['req', '-new', '-key', f('client2.key'), '-subj', '/CN=street-client-2', '-out', f('client2.csr')]);
    sh('openssl', ['x509', '-req', '-in', f('client2.csr'), '-CA', f('ca2.crt'), '-CAkey', f('ca2.key'), '-CAcreateserial', '-days', '2', '-sha256', '-out', f('client2.crt')]);
    opensslOk = existsSync(f('server.crt')) && existsSync(f('client.crt')) && existsSync(f('client2.crt'));
  } catch {
    opensslOk = false;
  }
});

after(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

describe('mTLS — fingerprint & pin helpers', () => {
  it('certificateFingerprint is a 64-char sha256 hex', () => {
    const fp = certificateFingerprint(Buffer.from('cert-bytes'));
    assert.match(fp, /^[0-9a-f]{64}$/);
  });
  it('verifyCertificatePin matches (colon/case-insensitive) and rejects others', () => {
    const der = Buffer.from('abc');
    const fp = certificateFingerprint(der);
    const colonized = fp.match(/.{2}/g)!.join(':').toUpperCase();
    assert.equal(verifyCertificatePin(der, [colonized]), true);
    assert.equal(verifyCertificatePin(der, ['00'.repeat(32)]), false);
  });
});

describe('mTLS — validateClientCert policy', () => {
  const cert: PeerCertLike = { subject: { CN: 'svc-a' }, raw: Buffer.from('clientcert') };
  it('requires a cert when required (default)', () => {
    assert.equal(validateClientCert(undefined, false).ok, false);
    assert.equal(validateClientCert(undefined, false, { required: false }).ok, true);
  });
  it('accepts a CA-authorized cert', () => {
    assert.equal(validateClientCert(cert, true).ok, true);
  });
  it('rejects an untrusted cert without pinning', () => {
    const r = validateClientCert(cert, false);
    assert.equal(r.ok, false); assert.equal(r.reason, 'untrusted_client_certificate');
  });
  it('accepts an untrusted-but-pinned cert (self-signed pinning)', () => {
    const pin = certificateFingerprint(cert.raw!);
    assert.equal(validateClientCert(cert, false, { allowedFingerprints: [pin] }).ok, true);
  });
  it('enforces CN allow-list', () => {
    assert.equal(validateClientCert(cert, true, { allowedCommonNames: ['svc-a'] }).ok, true);
    assert.equal(validateClientCert(cert, true, { allowedCommonNames: ['other'] }).ok, false);
  });
});

describe('mTLS — real handshake (requires openssl)', () => {
  it('accepts a client presenting a CA-signed cert and rejects one without', async (t) => {
    if (!opensslOk) { t.skip('openssl not available'); return; }
    const f = (n: string) => join(tmp, n);
    const server = createMutualTlsServer(
      { cert: readFileSync(f('server.crt')), key: readFileSync(f('server.key')), ca: readFileSync(f('ca.crt')), rejectUnauthorized: true },
      (req: IncomingMessage, res: ServerResponse) => {
        // Apply the middleware-equivalent validation.
        void clientCertMiddleware({ allowedCommonNames: ['street-client'] })(
          { req, state: {} },
          async () => undefined,
        ).then(() => { res.writeHead(200); res.end('authorized'); })
         .catch(() => { res.writeHead(401); res.end('denied'); });
      },
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as { port: number }).port;

    // With client cert → 200
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpsRequest({
        host: '127.0.0.1', port, method: 'GET', path: '/',
        ca: readFileSync(f('ca.crt')), cert: readFileSync(f('client.crt')), key: readFileSync(f('client.key')),
      }, (res) => { res.resume(); res.once('end', () => resolve(res.statusCode ?? 0)); });
      req.once('error', reject); req.end();
    });
    assert.equal(status, 200);

    // Without client cert → TLS layer rejects the connection (rejectUnauthorized).
    const failed = await new Promise<boolean>((resolve) => {
      const req = httpsRequest({ host: '127.0.0.1', port, method: 'GET', path: '/', ca: readFileSync(f('ca.crt')) }, (res) => { res.resume(); res.once('end', () => resolve(false)); });
      req.once('error', () => resolve(true));
      req.end();
    });
    assert.equal(failed, true, 'connection without client cert must be rejected');

    server.close();
  });
});

describe('mTLS — TrustStore', () => {
  it('manages CAs and pins (add/remove/list)', () => {
    const ts = new TrustStore({ ca: ['CA-A'], pins: ['AA:BB'] });
    ts.addCa('CA-B').addPin('cc:dd');
    assert.deepEqual(ts.caCertificates().map(String).sort(), ['CA-A', 'CA-B']);
    assert.deepEqual(ts.pins().sort(), ['aabb', 'ccdd']);
    assert.equal(ts.removeCa('CA-A'), true);
    assert.equal(ts.removeCa('CA-A'), false);
    assert.equal(ts.removePin('AABB'), true);
    assert.deepEqual(ts.caCertificates().map(String), ['CA-B']);
    assert.deepEqual(ts.pins(), ['ccdd']);
  });
  it('is idempotent for duplicate CA input', () => {
    const ts = new TrustStore();
    ts.addCa('CA-X').addCa('CA-X');
    assert.equal(ts.caCertificates().length, 1);
  });
  it('validates via configured pins; rotate() swaps the whole set', () => {
    const cert: PeerCertLike = { subject: { CN: 'svc' }, raw: Buffer.from('rawcert') };
    const pin = certificateFingerprint(cert.raw!);
    const ts = new TrustStore({ pins: [pin] });
    // Pinned, untrusted-at-TLS cert is accepted because a pin matches.
    assert.equal(ts.validate(cert, false).ok, true);
    // After rotating to a different pin set, the same cert is rejected.
    ts.rotate({ pins: ['00'.repeat(32)] });
    assert.equal(ts.validate(cert, false).ok, false);
  });
});

describe('mTLS — live certificate rotation (requires openssl)', () => {
  it('rotateServerCertificate swaps the trusted client CA without restart', async (t) => {
    if (!opensslOk) { t.skip('openssl not available'); return; }
    const f = (n: string) => join(tmp, n);
    const server = createMutualTlsServer(
      { cert: readFileSync(f('server.crt')), key: readFileSync(f('server.key')), ca: readFileSync(f('ca.crt')), rejectUnauthorized: true },
      (_req: IncomingMessage, res: ServerResponse) => { res.writeHead(200); res.end('ok'); },
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as { port: number }).port;

    // Clients always verify the server with ca.crt; they present their own client cert.
    const call = (clientCrt: string, clientKey: string) => new Promise<number | 'error'>((resolve) => {
      const req = httpsRequest({
        host: '127.0.0.1', port, method: 'GET', path: '/',
        ca: readFileSync(f('ca.crt')), cert: readFileSync(f(clientCrt)), key: readFileSync(f(clientKey)),
      }, (res) => { res.resume(); res.once('end', () => resolve(res.statusCode ?? 0)); });
      req.once('error', () => resolve('error'));
      req.end();
    });

    // Initially the server trusts CA1 → client (CA1) accepted, client2 (CA2) rejected.
    assert.equal(await call('client.crt', 'client.key'), 200);
    assert.equal(await call('client2.crt', 'client2.key'), 'error');

    // Rotate the trusted client CA to CA2 (server identity unchanged).
    rotateServerCertificate(server, {
      cert: readFileSync(f('server.crt')), key: readFileSync(f('server.key')), ca: readFileSync(f('ca2.crt')),
    });

    // Now client2 (CA2) is accepted and the original client (CA1) is rejected.
    assert.equal(await call('client2.crt', 'client2.key'), 200);
    assert.equal(await call('client.crt', 'client.key'), 'error');

    server.close();
  });
});
