// scripts/tests/generate-sbom-purl.test.mjs
// Class C bug-condition exploration test (CodeQL alert #25) — incomplete encoding.
//
// Bug condition (isBugCondition_C): a package name contains a character requiring
// escaping (e.g. `@`) BEYOND the first occurrence. The originally-flagged code
// (scripts/generate-sbom.mjs:44) used `dp.name.replace('@','%40')` — a STRING
// first argument, which replaces only the FIRST match — so a name like `a@b@c`
// would be encoded to `a%40b@c`, leaving the second `@` unescaped.
//
// Safety / fix-checking property (bugfix.md / design.md Property 3):
//   FOR ALL name WHERE isBugCondition_C(name) DO
//     purl := buildPurl'(name)
//     ASSERT purl contains no unescaped special character (`@`) in the name segment
//   END FOR
//
// On the original (first-match-only) code this assertion FAILS — the residual
// `@` beyond the first is the counterexample proving the bug exists.
//
// **Validates: Requirements 1.5**

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPurl } from '../generate-sbom.mjs';

/** isBugCondition_C: name has a character requiring escaping beyond the first. */
function isBugCondition_C(name) {
  return name.indexOf('@') !== name.lastIndexOf('@'); // more than one '@'
}

/**
 * Extract the package-name segment of a purl: everything between the
 * `pkg:npm/` prefix and the final `@<version>` separator.
 */
function nameSegment(purl) {
  const body = purl.slice('pkg:npm/'.length);
  return body.slice(0, body.lastIndexOf('@'));
}

describe('Class C — SBOM purl incomplete encoding (alert #25, generate-sbom.mjs:44)', () => {
  it('encodes every special character in a name satisfying isBugCondition_C', () => {
    const name = 'a@b@c'; // two '@' → isBugCondition_C holds
    assert.ok(isBugCondition_C(name), 'precondition: name must satisfy isBugCondition_C');

    const purl = buildPurl(name, '1.0.0');
    const seg = nameSegment(purl);

    // SAFETY assertion: no unescaped '@' may remain in the encoded name segment.
    // On the original first-match-only code the name segment is `a%40b@c`, so this
    // assertion FAILS — the residual second '@' is the counterexample.
    assert.ok(
      !seg.includes('@'),
      `purl name segment left an unescaped '@': got "${purl}" ` +
        `(name segment "${seg}") — incomplete encoding (isBugCondition_C)`,
    );
  });
});
