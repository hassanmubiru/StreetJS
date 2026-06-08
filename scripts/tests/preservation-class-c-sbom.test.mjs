// scripts/tests/preservation-class-c-sbom.test.mjs
// Class C preservation baseline (Property 7 — Non-Buggy Inputs Unchanged).
//
// Captures the CURRENT (pre-fix) behavior of the SBOM purl builder for the
// preservation domain — names that do NOT satisfy isBugCondition_C, i.e. names
// with at most one '@':
//   - plain unscoped names (no '@')
//   - standard single-'@' scoped names (e.g. @scope/pkg)
//
// For these inputs the fixed buildPurl must produce byte-identical purls and the
// overall sorted SBOM `components` ordering must be unchanged: F(X) === F'(X).
//
// No fast-check available — Property-style coverage uses a deterministic seeded
// PRNG so the sampled names are reproducible run-to-run. The oracle is the
// observed encoding contract of the current seam (the name segment is the
// URL-encoding of the package name), pinned independently of the seam internals.
//
// **Validates: Requirements 3.3, 3.7**

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPurl } from '../generate-sbom.mjs';

const VERSION = '1.2.3';

// ── Deterministic seeded PRNG (mulberry32) ───────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** isBugCondition_C: name has a character requiring escaping beyond the first. */
function isBugCondition_C(name) {
  return name.indexOf('@') !== name.lastIndexOf('@'); // more than one '@'
}

/** Independent oracle for the name segment: the URL-encoding of the name. */
function expectedPurl(name, version) {
  return `pkg:npm/${encodeURIComponent(name)}@${version}`;
}

// Realistic npm unscoped-name alphabet — never contains '@'.
const NAME_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789-._';
function randomUnscoped(rng, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += NAME_CHARS[Math.floor(rng() * NAME_CHARS.length)];
  return s;
}

describe('Class C preservation — purls for non-buggy names unchanged', () => {
  it('plain unscoped names (no @) keep the name segment byte-identical', () => {
    const rng = mulberry32(0x5b0_c0de);
    for (let trial = 0; trial < 1000; trial++) {
      const len = 1 + Math.floor(rng() * 24);
      const name = randomUnscoped(rng, len);
      assert.equal(isBugCondition_C(name), false, 'precondition: non-buggy (no @)');

      const purl = buildPurl(name, VERSION);
      // None of NAME_CHARS require URL-encoding, so the name segment is unchanged.
      assert.equal(purl, `pkg:npm/${name}@${VERSION}`, `purl changed an escape-free name: ${name}`);
      // And it matches the independent URL-encoding oracle.
      assert.equal(purl, expectedPurl(name, VERSION));
    }
  });

  it('standard single-@ scoped names produce the observed purl', () => {
    const rng = mulberry32(0x5c0_9ed);
    for (let trial = 0; trial < 1000; trial++) {
      const scopeLen = 1 + Math.floor(rng() * 12);
      const pkgLen = 1 + Math.floor(rng() * 12);
      const name = `@${randomUnscoped(rng, scopeLen)}/${randomUnscoped(rng, pkgLen)}`;
      assert.equal(isBugCondition_C(name), false, 'precondition: single @ → non-buggy');

      const purl = buildPurl(name, VERSION);
      // Baseline: the leading '@' is encoded (no unescaped '@' in the segment),
      // matching the observed URL-encoding contract of the current seam.
      assert.equal(purl, expectedPurl(name, VERSION));
      const seg = purl.slice('pkg:npm/'.length, purl.lastIndexOf('@'));
      assert.ok(!seg.includes('@'), `scoped name left an unescaped @: ${purl}`);
    }
  });

  it('matches the observed golden purls for representative names', () => {
    // Exact current outputs observed on the unfixed seam — the locked baseline.
    const golden = [
      ['lodash', 'pkg:npm/lodash@1.2.3'],
      ['typescript', 'pkg:npm/typescript@1.2.3'],
      ['left-pad', 'pkg:npm/left-pad@1.2.3'],
      ['a.b-c_d', 'pkg:npm/a.b-c_d@1.2.3'],
      ['@scope/pkg', 'pkg:npm/%40scope%2Fpkg@1.2.3'],
      ['@types/node', 'pkg:npm/%40types%2Fnode@1.2.3'],
    ];
    for (const [name, expected] of golden) {
      assert.equal(buildPurl(name, VERSION), expected, `golden purl mismatch for ${name}`);
    }
  });
});

describe('Class C preservation — sorted SBOM components unchanged', () => {
  it('orders components by purl.localeCompare exactly as the generator does', () => {
    // A representative dependency set (mixed plain + single-@ scoped names).
    const deps = [
      { name: 'typescript', version: '5.4.0' },
      { name: '@types/node', version: '20.0.0' },
      { name: 'lodash', version: '4.17.21' },
      { name: '@scope/pkg', version: '1.0.0' },
      { name: 'left-pad', version: '1.3.0' },
    ];

    // Build components the same way generate-sbom.mjs does, keyed/sorted by purl.
    const components = deps.map((d) => {
      const purl = buildPurl(d.name, d.version);
      return { type: 'library', 'bom-ref': purl, name: d.name, version: d.version, purl };
    });
    const sorted = [...components].sort((a, b) => a.purl.localeCompare(b.purl));

    // Observed baseline ordering of the purls (the SBOM component order).
    const expectedOrder = [
      'pkg:npm/%40scope%2Fpkg@1.0.0',
      'pkg:npm/%40types%2Fnode@20.0.0',
      'pkg:npm/left-pad@1.3.0',
      'pkg:npm/lodash@4.17.21',
      'pkg:npm/typescript@5.4.0',
    ];
    assert.deepEqual(sorted.map((c) => c.purl), expectedOrder);

    // bom-ref stays consistent with purl (derived from the same value).
    for (const c of sorted) assert.equal(c['bom-ref'], c.purl);
  });
});
