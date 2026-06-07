// tests/security-headers.test.ts
// Tests the configurable CSP builder / security-headers preset and verifies the
// runtime's native defense against CRLF header injection (response splitting).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { buildCsp, computeSecurityHeaders, securityHeadersMiddleware, DEFAULT_CSP } from '../security/headers.js';

describe('CSP builder', () => {
  it('quotes CSP keywords and emits hosts verbatim', () => {
    const csp = buildCsp({ 'default-src': ['self'], 'img-src': ['self', 'https://cdn.example.com'], 'object-src': ['none'] });
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /img-src 'self' https:\/\/cdn\.example\.com/);
    assert.match(csp, /object-src 'none'/);
  });

  it('supports valueless directives and nonce/hash quoting', () => {
    const csp = buildCsp({ 'upgrade-insecure-requests': true, 'script-src': ['self', 'nonce-abc123'] });
    assert.match(csp, /upgrade-insecure-requests/);
    assert.match(csp, /script-src 'self' 'nonce-abc123'/);
  });

  it('default preset is same-origin and frame-denied', () => {
    const csp = buildCsp(DEFAULT_CSP);
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
  });
});

describe('computeSecurityHeaders', () => {
  it('produces the hardened default set', () => {
    const h = computeSecurityHeaders();
    assert.ok(h['Content-Security-Policy']);
    assert.match(h['Strict-Transport-Security']!, /max-age=63072000/);
    assert.equal(h['X-Content-Type-Options'], 'nosniff');
    assert.equal(h['X-Frame-Options'], 'DENY');
    assert.equal(h['Cross-Origin-Opener-Policy'], 'same-origin');
  });

  it('honours options (omit CSP, custom HSTS, SAMEORIGIN frames)', () => {
    const h = computeSecurityHeaders({ csp: false, hstsMaxAge: 0, frameOptions: 'SAMEORIGIN' });
    assert.equal(h['Content-Security-Policy'], undefined);
    assert.equal(h['Strict-Transport-Security'], undefined);
    assert.equal(h['X-Frame-Options'], 'SAMEORIGIN');
  });

  it('middleware applies all headers to the context sink', async () => {
    const mw = securityHeadersMiddleware();
    const set: Record<string, string> = {};
    await mw({ setHeader: (n, v) => { set[n] = v; } }, async () => {});
    assert.ok(set['Content-Security-Policy']);
    assert.equal(set['X-Content-Type-Options'], 'nosniff');
  });
});

describe('Header injection / response splitting defense', () => {
  it('the Node HTTP layer rejects CRLF in header values (no response splitting)', async () => {
    const server = createServer((_req, res) => {
      let threw = false;
      try {
        // Attacker-controlled value attempting to inject a second header / body.
        res.setHeader('X-Test', 'ok\r\nSet-Cookie: evil=1');
      } catch {
        threw = true;
      }
      res.setHeader('X-Injection-Rejected', threw ? 'yes' : 'no');
      res.end('done');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as { port: number }).port;

    const headers = await new Promise<Record<string, string | string[] | undefined>>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: '/', method: 'GET' }, (res) => {
        res.resume();
        res.once('end', () => resolve(res.headers));
      });
      req.once('error', reject);
      req.end();
    });
    server.close();

    // Node throws ERR_INVALID_CHAR on CRLF in a header value, so no Set-Cookie leaks.
    assert.equal(headers['x-injection-rejected'], 'yes');
    assert.equal(headers['set-cookie'], undefined);
  });
});
