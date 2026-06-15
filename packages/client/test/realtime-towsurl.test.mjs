// toWsUrl: regex-free http(s)→ws(s) conversion. Covers scheme mapping, trailing
// slash normalization, relative bases, browser location fallback, and ReDoS-class
// adversarial inputs (long '/' runs) that must stay O(n) and exception-free.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { toWsUrl } from '../dist/index.js';

afterEach(() => { delete globalThis.location; });

describe('toWsUrl — scheme conversion', () => {
  it('http:// → ws://', () => {
    assert.equal(toWsUrl('http://localhost:3000', '/realtime'), 'ws://localhost:3000/realtime');
  });
  it('https:// → wss://', () => {
    assert.equal(toWsUrl('https://api.example.com', '/realtime'), 'wss://api.example.com/realtime');
  });
  it('preserves host, port, and path segments', () => {
    assert.equal(toWsUrl('https://h.co:8443/base', '/rt'), 'wss://h.co:8443/base/rt');
  });
  it('normalizes a path without a leading slash', () => {
    assert.equal(toWsUrl('http://h.co', 'rt'), 'ws://h.co/rt');
  });
});

describe('toWsUrl — trailing slash normalization', () => {
  it('strips a single trailing slash', () => {
    assert.equal(toWsUrl('https://api.example.com/', '/rt'), 'wss://api.example.com/rt');
  });
  it('strips many trailing slashes', () => {
    assert.equal(toWsUrl('https://api.example.com///', '/rt'), 'wss://api.example.com/rt');
  });
  it('leaves internal slashes untouched', () => {
    assert.equal(toWsUrl('https://api.example.com/a/b///', '/rt'), 'wss://api.example.com/a/b/rt');
  });
});

describe('toWsUrl — relative base (browser location fallback)', () => {
  it('throws without a browser location', () => {
    assert.throws(() => toWsUrl('/api', '/rt'), /absolute baseUrl/);
  });
  it('uses location.origin and maps http→ws', () => {
    globalThis.location = { origin: 'http://localhost:5173' };
    assert.equal(toWsUrl('/api', '/rt'), 'ws://localhost:5173/api/rt');
  });
  it('uses location.origin and maps https→wss', () => {
    globalThis.location = { origin: 'https://app.example.com' };
    assert.equal(toWsUrl('/api', '/rt'), 'wss://app.example.com/api/rt');
  });
  it('relative base "/api/" and "/api///" normalize the same as "/api"', () => {
    globalThis.location = { origin: 'https://app.example.com' };
    const expected = 'wss://app.example.com/api/rt';
    assert.equal(toWsUrl('/api', '/rt'), expected);
    assert.equal(toWsUrl('/api/', '/rt'), expected);
    assert.equal(toWsUrl('/api///', '/rt'), expected);
  });
});

describe('toWsUrl — backward compatibility', () => {
  it('matches the documented examples exactly', () => {
    assert.equal(toWsUrl('https://h.co/api', '/realtime'), 'wss://h.co/api/realtime');
    assert.equal(toWsUrl('http://h.co', 'rt'), 'ws://h.co/rt');
  });
});

describe('toWsUrl — ReDoS / security edge cases', () => {
  it('handles a 100k-slash absolute base in linear time without throwing', () => {
    const evil = 'https://example.com' + '/'.repeat(100_000);
    const start = process.hrtime.bigint();
    const out = toWsUrl(evil, '/rt');
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.equal(out, 'wss://example.com/rt');     // all trailing slashes collapsed
    assert.ok(ms < 50, `expected <50ms, took ${ms.toFixed(2)}ms`);
  });
  it('handles a 100k-slash path argument without throwing', () => {
    const out = toWsUrl('http://h.co', '/'.repeat(100_000));
    // path already starts with '/', so it is used verbatim (no trailing-trim on path)
    assert.equal(out, 'ws://h.co' + '/'.repeat(100_000));
  });
  it('is deterministic across repeated runs', () => {
    const evil = 'https://example.com' + '/'.repeat(50_000);
    const a = toWsUrl(evil, '/rt');
    const b = toWsUrl(evil, '/rt');
    assert.equal(a, b);
    assert.equal(a, 'wss://example.com/rt');
  });
  it('a base that is only slashes collapses to the bare ws scheme + path', () => {
    assert.equal(toWsUrl('https://////', '/rt'), 'wss:/rt');
  });
});
