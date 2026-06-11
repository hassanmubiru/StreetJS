// tests/security-headers-defaults.test.ts
// Unit tests for the production-safe DEFAULT values of the
// Security_Headers_Middleware (Phase 3, Requirement 4).
//
// Feature: consumer-platform-security
// Validates: Requirements 4.3 — "THE Security_Headers_Middleware SHALL set
// production-safe default values for each header that restrict content sources
// to the same origin and deny framing."
//
// Companion to:
//   - security-headers.test.ts        (CSP builder + option/override behaviour)
//   - headers-set-invariance-pbt.test.ts (Property 6: set invariance/override/disable)
// This file asserts the *concrete default values* are same-origin-restrictive
// and framing-denied, which the set-invariance property does not check.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeSecurityHeaders, DEFAULT_CSP, buildCsp } from '../security/headers.js';

describe('Security headers — production-safe default values (R4.3)', () => {
  it('Content-Security-Policy default restricts sources to the same origin', () => {
    const h = computeSecurityHeaders();
    const csp = h['Content-Security-Policy'];
    assert.ok(csp, 'CSP must be present by default');
    // default-src and script-src are limited to 'self' (same origin only).
    assert.match(csp!, /default-src 'self'/);
    assert.match(csp!, /script-src 'self'/);
    // base-uri locked to self prevents <base> hijacking to another origin.
    assert.match(csp!, /base-uri 'self'/);
    // No wildcard or cross-origin allowances leak into the default policy.
    assert.doesNotMatch(csp!, /\*/);
    assert.doesNotMatch(csp!, /https?:\/\//);
  });

  it('Content-Security-Policy default denies framing of the page', () => {
    const h = computeSecurityHeaders();
    const csp = h['Content-Security-Policy'];
    // frame-ancestors 'none' forbids the page from being embedded anywhere.
    assert.match(csp!, /frame-ancestors 'none'/);
    // object-src 'none' blocks plugin/embedded content vectors.
    assert.match(csp!, /object-src 'none'/);
  });

  it('DEFAULT_CSP preset itself is same-origin and frame-denied', () => {
    assert.deepEqual(DEFAULT_CSP['default-src'], ['self']);
    assert.deepEqual(DEFAULT_CSP['script-src'], ['self']);
    assert.deepEqual(DEFAULT_CSP['base-uri'], ['self']);
    assert.deepEqual(DEFAULT_CSP['object-src'], ['none']);
    assert.deepEqual(DEFAULT_CSP['frame-ancestors'], ['none']);
    // The built string is consistent with what the middleware emits by default.
    assert.equal(computeSecurityHeaders()['Content-Security-Policy'], buildCsp(DEFAULT_CSP));
  });

  it('X-Frame-Options default denies framing', () => {
    const h = computeSecurityHeaders();
    assert.equal(h['X-Frame-Options'], 'DENY');
  });

  it('Strict-Transport-Security default enforces HTTPS for a long horizon with subdomains and preload', () => {
    const h = computeSecurityHeaders();
    const hsts = h['Strict-Transport-Security'];
    assert.ok(hsts, 'HSTS must be present by default');
    // Two-year max-age (63072000s) is a production-safe long horizon.
    assert.match(hsts!, /max-age=63072000/);
    assert.match(hsts!, /includeSubDomains/);
    assert.match(hsts!, /preload/);
    const maxAge = Number(/max-age=(\d+)/.exec(hsts!)![1]);
    assert.ok(maxAge >= 31536000, 'HSTS max-age should be at least one year');
  });

  it('X-Content-Type-Options default disables MIME sniffing', () => {
    const h = computeSecurityHeaders();
    assert.equal(h['X-Content-Type-Options'], 'nosniff');
  });

  it('Referrer-Policy default restricts cross-origin referrer leakage', () => {
    const h = computeSecurityHeaders();
    assert.equal(h['Referrer-Policy'], 'strict-origin-when-cross-origin');
  });

  it('Permissions-Policy default denies powerful features by default', () => {
    const h = computeSecurityHeaders();
    const pp = h['Permissions-Policy'];
    assert.ok(pp, 'Permissions-Policy must be present by default');
    // Each feature is gated to an empty allowlist () — no origin may use it.
    assert.match(pp!, /geolocation=\(\)/);
    assert.match(pp!, /microphone=\(\)/);
    assert.match(pp!, /camera=\(\)/);
  });

  it('cross-origin isolation defaults lock resources/openers to the same origin', () => {
    const h = computeSecurityHeaders();
    assert.equal(h['Cross-Origin-Opener-Policy'], 'same-origin');
    assert.equal(h['Cross-Origin-Resource-Policy'], 'same-origin');
  });
});
