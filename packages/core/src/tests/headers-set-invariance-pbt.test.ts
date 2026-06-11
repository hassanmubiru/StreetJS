// tests/headers-set-invariance-pbt.test.ts
// Property-based test for the Security_Headers_Middleware (Phase 3, Requirement 4).
//
// Feature: consumer-platform-security, Property 6 — Security-header set
// invariance with override and disable.
// Validates: Requirements 4.2, 4.4, 4.5, 4.6
//
// This file proves three things across arbitrary routes, response bodies, and
// supplied options:
//   1. Set invariance (R4.2/R4.6): under default configuration the *set* of
//      security-header names produced is identical and independent of the route
//      or response body — `computeSecurityHeaders` is a pure function of its
//      options only, so the applied header names never vary with request/response
//      content.
//   2. Override (R4.4): for any supplied header value, the output uses the
//      supplied value in place of the corresponding default.
//   3. Disable (R4.5): for any set of explicitly disabled header names, those
//      names are absent from the output.
//
// Kept in its own *-pbt.test.ts file per the repo convention so the universal
// property is exercised across many generated inputs without disturbing the
// example/edge-case unit tests in security-headers.test.ts.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  buildCsp,
  computeSecurityHeaders,
  securityHeadersMiddleware,
  type CspDirectives,
  type SecurityHeaderName,
  type SecurityHeadersOptions,
} from '../security/headers.js';

const NUM_RUNS = 100;

// The names the middleware always emits under default configuration. These are
// independent of any request/response content because `computeSecurityHeaders`
// takes only options as input.
const DEFAULT_HEADER_NAMES: readonly string[] = [
  'Content-Security-Policy',
  'Strict-Transport-Security',
  'X-Content-Type-Options',
  'X-Frame-Options',
  'Cross-Origin-Opener-Policy',
  'Cross-Origin-Resource-Policy',
  'Referrer-Policy',
  'Permissions-Policy',
];

// The headers an application may explicitly override or disable (R4.4/R4.5).
const DISABLEABLE: readonly SecurityHeaderName[] = [
  'Content-Security-Policy',
  'Strict-Transport-Security',
  'X-Frame-Options',
  'X-Content-Type-Options',
  'Referrer-Policy',
  'Permissions-Policy',
];

const nameSet = (h: Record<string, string>): Set<string> => new Set(Object.keys(h));

// ── Generators ────────────────────────────────────────────────────────────────

// A "route + response body" pair standing in for arbitrary request/response
// content. The middleware must ignore both entirely.
const routeArb = fc
  .webPath()
  .filter((p) => p.length > 0)
  .map((p) => (p.startsWith('/') ? p : `/${p}`));
const bodyArb = fc.oneof(
  fc.string(),
  fc.json(),
  fc.constant(''),
  fc.uint8Array().map((u) => Buffer.from(u).toString('latin1')),
);

// Header values free of CR/LF so they are legal header values and round-trip
// cleanly through the computed map.
const headerValueArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => !/[\r\n]/.test(s));

// A small but varied CSP directive map; values are arrays of self/host tokens.
const cspArb: fc.Arbitrary<CspDirectives> = fc
  .dictionary(
    fc.constantFrom('default-src', 'script-src', 'img-src', 'connect-src', 'style-src'),
    fc.array(fc.constantFrom('self', 'none', 'https://cdn.example.com', 'data:'), {
      minLength: 1,
      maxLength: 3,
    }),
    { minKeys: 1, maxKeys: 5 },
  );

// ── Property 6a: set invariance under default configuration ─────────────────────

// Feature: consumer-platform-security, Property 6: Security-header set invariance with override and disable
// Validates: Requirements 4.2, 4.6
describe('Property 6: security-header set invariance under default configuration', () => {
  it('produces an identical header-name set regardless of route or response body (R4.6)', async () => {
    await fc.assert(
      fc.asyncProperty(routeArb, bodyArb, async (_route, _body) => {
        // The middleware ignores content: apply it against a sink and capture
        // the names it sets. They must match the canonical default set exactly.
        const applied: Record<string, string> = {};
        const mw = securityHeadersMiddleware();
        await mw({ setHeader: (n, v) => { applied[n] = v; } }, async () => {});

        assert.deepEqual(
          [...nameSet(applied)].sort(),
          [...DEFAULT_HEADER_NAMES].sort(),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('includes all six required default headers on every response (R4.2)', async () => {
    await fc.assert(
      fc.asyncProperty(routeArb, bodyArb, async () => {
        const h = computeSecurityHeaders();
        for (const required of [
          'Content-Security-Policy',
          'Strict-Transport-Security',
          'X-Frame-Options',
          'X-Content-Type-Options',
          'Referrer-Policy',
          'Permissions-Policy',
        ]) {
          assert.ok(h[required], `expected default header ${required} to be present`);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ── Property 6b: supplied values override defaults ──────────────────────────────

// Feature: consumer-platform-security, Property 6: Security-header set invariance with override and disable
// Validates: Requirements 4.4
describe('Property 6: supplied header values override the defaults', () => {
  it('uses each supplied option value in place of the default (R4.4)', async () => {
    await fc.assert(
      fc.property(
        fc.record({
          csp: cspArb,
          hstsMaxAge: fc.integer({ min: 1, max: 63072000 }),
          frameOptions: fc.constantFrom<'DENY' | 'SAMEORIGIN'>('DENY', 'SAMEORIGIN'),
          referrerPolicy: headerValueArb,
          permissionsPolicy: headerValueArb,
        }),
        (opts) => {
          const baseline = computeSecurityHeaders();
          const h = computeSecurityHeaders(opts as SecurityHeadersOptions);

          // Each supplied value replaces the corresponding default verbatim.
          assert.equal(h['Content-Security-Policy'], buildCsp(opts.csp));
          assert.equal(
            h['Strict-Transport-Security'],
            `max-age=${opts.hstsMaxAge}; includeSubDomains; preload`,
          );
          assert.equal(h['X-Frame-Options'], opts.frameOptions);
          assert.equal(h['Referrer-Policy'], opts.referrerPolicy);
          assert.equal(h['Permissions-Policy'], opts.permissionsPolicy);

          // Overriding values must not change which header names are present.
          assert.deepEqual([...nameSet(h)].sort(), [...nameSet(baseline)].sort());
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ── Property 6c: explicitly disabled headers are omitted ────────────────────────

// Feature: consumer-platform-security, Property 6: Security-header set invariance with override and disable
// Validates: Requirements 4.5
describe('Property 6: explicitly disabled headers are omitted', () => {
  it('omits exactly the disabled header names from the output (R4.5)', async () => {
    await fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...DISABLEABLE)),
        (disable) => {
          const baseline = computeSecurityHeaders();
          const h = computeSecurityHeaders({ disable });

          // Every disabled name is absent.
          for (const name of disable) {
            assert.equal(h[name], undefined, `expected ${name} to be omitted`);
          }

          // Nothing else is removed: the surviving set equals the baseline minus
          // exactly the disabled names.
          const expected = new Set(nameSet(baseline));
          for (const name of disable) expected.delete(name);
          assert.deepEqual([...nameSet(h)].sort(), [...expected].sort());
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
