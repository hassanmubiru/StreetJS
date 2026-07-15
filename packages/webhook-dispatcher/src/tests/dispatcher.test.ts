import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';

import { WebhookDispatcher, buildRequestOptions } from '../dispatcher.js';
import { WEBHOOK_DISPATCHER } from '../index.js';

// ── buildRequestOptions (pure) ───────────────────────────────────────────────

test('buildRequestOptions maps the URL and headers and never disables TLS validation', () => {
  const opts = buildRequestOptions('https://api.example.com/hooks?x=1', 42, 'sha256=abc', 5000);
  assert.equal(opts.hostname, 'api.example.com');
  assert.equal(opts.port, 443);
  assert.equal(opts.path, '/hooks?x=1');
  assert.equal(opts.method, 'POST');
  const headers = opts.headers as Record<string, unknown>;
  assert.equal(headers['Content-Length'], 42);
  assert.equal(headers['X-Street-Signature'], 'sha256=abc');
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(opts.timeout, 5000);
  // Certificate validation is never disabled.
  assert.equal('rejectUnauthorized' in opts, false);
});

test('buildRequestOptions honors a custom port and passes a private CA', () => {
  const opts = buildRequestOptions('https://host:8443/p', 1, 'sig', 1000, { ca: 'CACERT', rejectUnauthorized: false });
  assert.equal(opts.port, '8443');
  assert.equal((opts as { ca?: unknown }).ca, 'CACERT'); // ca passed through
  assert.equal('rejectUnauthorized' in opts, false); // still never forwarded
});

// ── enqueue guards & URL validation ──────────────────────────────────────────

function captureConsole(): { restore: () => void; errors: string[]; warns: string[] } {
  const errors: string[] = [];
  const warns: string[] = [];
  const origErr = console.error;
  const origWarn = console.warn;
  console.error = (...a: unknown[]): void => void errors.push(a.join(' '));
  console.warn = (...a: unknown[]): void => void warns.push(a.join(' '));
  return {
    errors,
    warns,
    restore: () => {
      console.error = origErr;
      console.warn = origWarn;
    },
  };
}

const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('enqueue returns false after stop()', () => {
  const d = new WebhookDispatcher();
  d.stop();
  assert.equal(d.enqueue({ url: 'https://x.example', secret: 's' }, 'e', {}), false);
});

test('a non-HTTPS URL is validated out and the event is dropped', async () => {
  const cap = captureConsole();
  try {
    const d = new WebhookDispatcher();
    assert.equal(d.enqueue({ url: 'http://insecure.example', secret: 's' }, 'e', {}), true); // sync accept
    await tick();
    d.stop();
    assert.ok(cap.errors.some((e) => /validation failed/.test(e) && /https/.test(e)));
  } finally {
    cap.restore();
  }
});

test('a private/blocked IP literal is rejected (SSRF)', async () => {
  const cap = captureConsole();
  try {
    const d = new WebhookDispatcher(); // 10.0.0.1 not in allowedHosts
    d.enqueue({ url: 'https://10.0.0.1/hook', secret: 's' }, 'e', {});
    await tick();
    d.stop();
    assert.ok(cap.errors.some((e) => /validation failed/.test(e)));
  } finally {
    cap.restore();
  }
});

test('DI token is a stable global symbol', () => {
  assert.equal(WEBHOOK_DISPATCHER, Symbol.for('@streetjs/webhook-dispatcher:Dispatcher'));
});

// ── HTTPS integration (self-signed cert via openssl) ─────────────────────────

let certDir: string;
let caCert: string;

before(() => {
  certDir = mkdtempSync(join(tmpdir(), 'street-wh-'));
  const keyPath = join(certDir, 'key.pem');
  const certPath = join(certDir, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath,
    '-days', '1', '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1',
  ], { stdio: 'ignore' });
  caCert = readFileSync(certPath, 'utf8');
  (globalThis as Record<string, unknown>).__wh_key = readFileSync(keyPath, 'utf8');
  (globalThis as Record<string, unknown>).__wh_cert = caCert;
});

after(() => {
  if (certDir) rmSync(certDir, { recursive: true, force: true });
});

function startServer(handler: (req: import('node:http').IncomingMessage, body: string) => number): Promise<{ server: Server; port: number }> {
  const server = createServer(
    {
      key: (globalThis as Record<string, unknown>).__wh_key as string,
      cert: (globalThis as Record<string, unknown>).__wh_cert as string,
    },
    (req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const status = handler(req, body);
        res.writeHead(status);
        res.end();
      });
    },
  );
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === 'object' && addr ? addr.port : 0 });
    });
  });
}

test('delivers a signed payload over HTTPS to an allowed host', async () => {
  const received: { sig?: string; body?: string } = {};
  const { server, port } = await startServer((req, body) => {
    received.sig = req.headers['x-street-signature'] as string;
    received.body = body;
    return 200;
  });
  const done = new Promise<void>((resolve) => server.on('request', () => setTimeout(resolve, 10)));
  try {
    const secret = 'top-secret';
    const d = new WebhookDispatcher(['127.0.0.1']); // bypass SSRF for localhost
    d.enqueue({ url: `https://127.0.0.1:${port}/hook`, secret, tls: { ca: caCert } }, 'user.created', { id: 7 });
    await done;
    d.stop();
    assert.ok(received.body, 'server received a body');
    const expected = 'sha256=' + createHmac('sha256', secret).update(received.body!).digest('hex');
    assert.equal(received.sig, expected); // signature verifies over the exact bytes
    const payload = JSON.parse(received.body!);
    assert.equal(payload.event, 'user.created');
    assert.deepEqual(payload.data, { id: 7 });
    assert.match(payload.id, /^[0-9a-f]{32}$/);
  } finally {
    server.close();
  }
});

test('retries on a 5xx response then stops after maxRetries', async () => {
  let hits = 0;
  const { server, port } = await startServer(() => {
    hits++;
    return 500;
  });
  try {
    const d = new WebhookDispatcher(['127.0.0.1']);
    d.enqueue(
      { url: `https://127.0.0.1:${port}/hook`, secret: 's', tls: { ca: caCert }, maxRetries: 1 },
      'e',
      {},
    );
    // attempt 0 immediately, retry after ~1s → expect 2 hits total.
    await new Promise((r) => setTimeout(r, 1600));
    d.stop();
    assert.equal(hits, 2);
  } finally {
    server.close();
  }
});
