// packages/cli/src/tests/preservation-class-b-grpc-basename.test.ts
// Class B.2 preservation baseline (Property 7 — Non-Buggy Inputs Unchanged).
//
// Captures the CURRENT (pre-fix) behavior of deriveGrpcBaseName (generate.ts) —
// the gRPC output basename derivation flagged for ReDoS — for WELL-FORMED input
// (the preservation domain): valid POSIX `--proto` paths.
//
// The Class B.2 fix replaces the polynomial `/.*\//` strip with a linear
// `node:path` `basename` while keeping the derived filename byte-identical for
// valid POSIX `--proto` paths: F(X) === F'(X).
//
// No fast-check available — Property-style coverage uses a deterministic seeded
// PRNG so the sampled paths are reproducible run-to-run. The oracle is the
// POSIX basename (minus the `.proto` extension), which both the current regex
// and the linear fix must agree on for valid paths.
//
// (B.1 base32Decode and B.3 parseProto preservation live in the core package's
// preservation-class-b-equivalence.test.ts.)
//
// **Validates: Requirements 3.2, 3.7**

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { deriveGrpcBaseName } from '../commands/generate.js';

// ── Deterministic seeded PRNG (mulberry32) ───────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEG_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789_-';
function randomSegment(rng: () => number): string {
  const len = 1 + Math.floor(rng() * 12);
  let s = '';
  for (let i = 0; i < len; i++) s += SEG_CHARS[Math.floor(rng() * SEG_CHARS.length)];
  return s;
}

/** Oracle: the POSIX basename with the `.proto` extension stripped. */
function expectedBaseName(protoPath: string): string {
  return posix.basename(protoPath).replace(/\.proto$/, '');
}

describe('Class B.2 preservation — deriveGrpcBaseName unchanged for valid paths', () => {
  it('derives the same basename as the POSIX oracle for random valid proto paths', () => {
    const rng = mulberry32(0xba5e_4a3e);
    for (let trial = 0; trial < 1000; trial++) {
      const depth = Math.floor(rng() * 5); // 0..4 leading directory segments
      const dirs: string[] = [];
      for (let i = 0; i < depth; i++) dirs.push(randomSegment(rng));
      const file = `${randomSegment(rng)}.proto`;
      const protoPath = [...dirs, file].join('/');

      assert.equal(
        deriveGrpcBaseName(protoPath),
        expectedBaseName(protoPath),
        `basename mismatch for ${protoPath}`,
      );
    }
  });

  it('keeps fixed representative examples identical', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['service.proto', 'service'],
      ['proto/service.proto', 'service'],
      ['a/b/c/calc.proto', 'calc'],
      ['./pkg/foo_bar.proto', 'foo_bar'],
      ['order-service.proto', 'order-service'],
      ['nested/deep/path/v1.proto', 'v1'],
    ];
    for (const [input, expected] of cases) {
      assert.equal(deriveGrpcBaseName(input), expected, `mismatch for ${input}`);
      // And it agrees with the POSIX oracle.
      assert.equal(deriveGrpcBaseName(input), expectedBaseName(input));
    }
  });

  it('strips only a trailing .proto extension (single anchored literal)', () => {
    // A name that merely contains "proto" without the .proto suffix is untouched.
    assert.equal(deriveGrpcBaseName('protobuf_helpers.ts'), 'protobuf_helpers.ts');
    // Exactly one trailing .proto is removed.
    assert.equal(deriveGrpcBaseName('x.proto'), 'x');
  });
});
