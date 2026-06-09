// tests/package-migration.test.ts
// Verifies the @streetjs/core -> streetjs package rename:
//   1. `streetjs` (the renamed primary package) exposes the public API.
//   2. `@streetjs/core` (the backward-compat shim) re-exports an IDENTICAL
//      surface for the root entry and every subpath export.
//   3. The re-exported bindings are the SAME references (not copies), so the
//      compat package cannot drift from the real implementation.
//
// Run after build (build:app or build): node --test dist/tests/package-migration.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// The 22 public export subpaths declared in streetjs's package.json `exports`.
const SUBPATHS = [
  '', '/http', '/router', '/database', '/pool', '/repository', '/migrations',
  '/security', '/session', '/vault', '/ratelimit', '/xss', '/websocket', '/sse',
  '/cache', '/telemetry', '/cluster', '/cli', '/multipart', '/webhook',
  '/exceptions', '/browser',
] as const;

describe('package rename: @streetjs/core -> streetjs', () => {
  it('streetjs root export exposes the public API', async () => {
    // Computed specifier: this is a runtime resolution check, not a compile-time
    // type import (the bare literal would be unresolvable during this package's
    // own build, since it resolves to packages/core's not-yet-built dist).
    const STREETJS = ['street', 'js'].join('');
    const street = await import(STREETJS);
    const keys = Object.keys(street);
    assert.ok(keys.length > 0, 'streetjs root must export something');
    for (const api of ['PgPool', 'JwtService', 'WebhookDispatcher']) {
      assert.ok(api in street, `streetjs must export ${api}`);
    }
  });

  it('@streetjs/core compat shim resolves and re-exports streetjs', async () => {
    const CORE = ['@streetjs', 'core'].join('/');
    const core = await import(CORE);
    assert.ok(Object.keys(core).length > 0, '@streetjs/core must re-export the API');
    assert.ok('PgPool' in core, '@streetjs/core must re-export PgPool');
  });

  for (const sp of SUBPATHS) {
    it(`export surface is identical for "${sp || '(root)'}"`, async () => {
      const fromStreet = await import('street' + 'js' + sp);
      const fromCore = await import('@streetjs' + '/core' + sp);

      const ks = Object.keys(fromStreet).sort();
      const kc = Object.keys(fromCore).sort();
      assert.deepEqual(kc, ks, `export keys differ for subpath "${sp}"`);

      // Identity: each binding must be the SAME reference (compat re-exports, not copies).
      for (const k of ks) {
        if (k === 'default') continue;
        assert.equal(
          (fromCore as Record<string, unknown>)[k],
          (fromStreet as Record<string, unknown>)[k],
          `binding "${k}" in subpath "${sp}" is not the same reference`,
        );
      }
    });
  }
});
