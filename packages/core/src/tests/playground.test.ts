// tests/playground.test.ts
// Verifies the OpenAPI → interactive HTML playground generator: renders each
// operation, wires path params + body fields + the fetch runner, respects the
// base URL, and HTML-escapes untrusted spec content (XSS safety).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateOpenApi } from '../http/openapi.js';
import { openApiToHtml } from '../devx/playground.js';

describe('playground — HTML generation', () => {
  const doc = generateOpenApi([
    { method: 'GET', path: '/users/:id', summary: 'Get a user' },
    { method: 'POST', path: '/users', summary: 'Create a user' },
  ]);

  it('produces a complete HTML document with the title', () => {
    const html = openApiToHtml(doc, { title: 'My API' });
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<title>My API<\/title>/);
    assert.match(html, /<h1>My API<\/h1>/);
  });

  it('renders each operation with method + path', () => {
    const html = openApiToHtml(doc);
    assert.match(html, /data-method="GET"[^>]*data-path="\/users\/\{id\}"/);
    assert.match(html, /data-method="POST"[^>]*data-path="\/users"/);
    assert.match(html, /Get a user/);
    assert.match(html, /Create a user/);
  });

  it('adds a path-param input and a body textarea where appropriate', () => {
    const html = openApiToHtml(doc);
    assert.match(html, /data-param="id"/);            // GET /users/:id → param input
    assert.match(html, /<textarea data-body/);         // POST → body field
    // GET operations get no body textarea: count textareas == number of non-GET/HEAD ops (1)
    assert.equal((html.match(/<textarea data-body/g) ?? []).length, 1);
  });

  it('includes the fetch runner script and respects baseUrl', () => {
    const html = openApiToHtml(doc, { baseUrl: 'https://api.example.com' });
    assert.match(html, /function streetTry/);
    assert.match(html, /data-base="https:\/\/api\.example\.com"/);
  });

  it('HTML-escapes untrusted spec content (XSS safety)', () => {
    const evil = generateOpenApi([
      { method: 'GET', path: '/x', summary: '<script>alert(1)</script>' },
    ]);
    const html = openApiToHtml(evil);
    assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script must not be injected');
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  it('handles an empty spec gracefully', () => {
    const html = openApiToHtml({ openapi: '3.1.0', info: { title: 't', version: '1' }, paths: {} });
    assert.match(html, /No operations in the spec/);
  });
});
