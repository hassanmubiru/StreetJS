// tests/runtime-dependency-guardrail.test.ts
//
// Feature: security-hardening, Requirement 9 — dependency-light guardrail.
//
// StreetJS_Core promises EXACTLY three runtime dependencies. This guardrail
// asserts that `packages/core/package.json` declares precisely the set
// { 'reflect-metadata', 'ws', 'zod' } in its `dependencies` field — no more,
// no fewer. Any hardening change that smuggles in a new runtime dependency
// (or drops one) trips this test.
//
// This is an example/assertion test (not property-based) per Requirement 11.4:
// it concerns package configuration, so an example-based assertion is the
// appropriate evidence.
//
// Path resolution: this test is compiled to `dist/tests/<name>.test.js` and run
// via `node --test dist/tests/...`. Resolving `../../package.json` from
// `import.meta.url` (dist/tests -> dist -> packages/core) robustly locates the
// package manifest independent of the process working directory.
//
// Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXPECTED_RUNTIME_DEPENDENCIES = ['reflect-metadata', 'ws', 'zod'] as const;

// dist/tests/<name>.test.js -> ../../package.json == packages/core/package.json
const packageJsonPath = fileURLToPath(new URL('../../package.json', import.meta.url));

interface PackageJsonShape {
  name?: string;
  dependencies?: Record<string, string>;
}

function readCorePackageJson(): PackageJsonShape {
  const raw = readFileSync(packageJsonPath, 'utf8');
  return JSON.parse(raw) as PackageJsonShape;
}

describe('Requirement 9: dependency-light guardrail', () => {
  it('resolves the streetjs core package.json', () => {
    const pkg = readCorePackageJson();
    assert.equal(pkg.name, 'streetjs', `expected to read packages/core/package.json (at ${packageJsonPath})`);
  });

  it('declares a runtime dependencies object', () => {
    const pkg = readCorePackageJson();
    assert.ok(
      pkg.dependencies && typeof pkg.dependencies === 'object',
      'package.json must declare a `dependencies` object',
    );
  });

  it('declares EXACTLY three runtime dependencies', () => {
    const pkg = readCorePackageJson();
    const keys = Object.keys(pkg.dependencies ?? {});
    assert.equal(
      keys.length,
      EXPECTED_RUNTIME_DEPENDENCIES.length,
      `expected exactly ${EXPECTED_RUNTIME_DEPENDENCIES.length} runtime dependencies but found ${keys.length}: [${keys.join(', ')}]`,
    );
  });

  it('declares exactly the set { reflect-metadata, ws, zod } — no more, no fewer', () => {
    const pkg = readCorePackageJson();
    const actual = Object.keys(pkg.dependencies ?? {}).sort();
    const expected = [...EXPECTED_RUNTIME_DEPENDENCIES].sort();
    assert.deepEqual(
      actual,
      expected,
      `runtime dependency set drifted from the dependency-light guarantee (expected [${expected.join(', ')}], got [${actual.join(', ')}])`,
    );
  });
});
